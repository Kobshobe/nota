import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { messages as messagesTable, toolCalls as toolCallsTable, type MessageRow } from '../src/db/schema';
import { formatAssistantHistory } from '../src/agent/run';
import {
  assistantWithTools,
  call,
  createMeeting,
  createTestApp,
  dailyThreadId,
  finishOnly,
  finishWith,
  login,
  sendMessage,
  textOnly,
  type TestContext,
} from './helpers';

interface Authed {
  token: string;
}

describe('场景：Agent · 短命令创建事项', () => {
  let ctx: TestContext;
  let auth: Authed;

  beforeEach(async () => {
    ctx = await createTestApp();
    auth = await login(ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('create_item 暂存后由 finish 原子提交，返回事项和工具轨迹', async () => {
    // given：模型先创建待办，再 finish
    ctx.faux.setResponses([
      finishWith(
        [{ name: 'create_item', args: { title: '买牛奶', kind: 'todo' } }],
        { reply: '已记录：明天买牛奶' },
      ),
    ]);

    // when：发送短命令
    const response = await sendMessage(ctx, auth.token, '记一下，明天买牛奶');

    // then：响应符合契约，事项已提交
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual([
      'assistantMessage',
      'items',
      'toolCalls',
      'usage',
      'userMessage',
    ]);
    expect(response.body.assistantMessage.role).toBe('assistant');
    expect(response.body.assistantMessage.payload).toMatchObject({ reply: '已记录：明天买牛奶' });
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      title: '买牛奶',
      kind: 'todo',
      status: 'open',
    });
    // 待办不能凭空得到默认时间
    expect(response.body.items[0].dueAt).toBeUndefined();
    expect(response.body.usage.used).toBe(1);
    expect(response.body.toolCalls.map((trace: { name: string }) => trace.name)).toEqual([
      'create_item',
      'finish',
    ]);

    const stored = await call(ctx, {
      method: 'GET',
      url: '/api/items',
      token: auth.token,
    });
    expect(stored.body.items).toHaveLength(1);
    expect(stored.body.items[0].title).toBe('买牛奶');

    const threadId = await dailyThreadId(ctx, auth.token);
    const detail = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${threadId}`,
      token: auth.token,
    });
    expect(detail.body.messages).toHaveLength(2);
    expect(detail.body.messages[0]).toMatchObject({ role: 'user', content: '记一下，明天买牛奶' });
    expect(detail.body.messages[1]).toMatchObject({ role: 'assistant' });
    expect(detail.body.messages[1].toolCalls.map((trace: { name: string }) => trace.name)).toEqual([
      'create_item',
      'finish',
    ]);

    // then：payload、工具轨迹和完整响应都已持久化
    const storedMessages = ctx.app.db.select().from(messagesTable).all();
    expect(storedMessages).toHaveLength(2);
    const storedAssistant = storedMessages.find((row) => row.role === 'assistant')!;
    expect(storedAssistant.payloadJson).toContain('已记录：明天买牛奶');
    expect(storedAssistant.responseJson).toContain('"toolCalls"');
    const storedTraces = ctx.app.db.select().from(toolCallsTable).all();
    expect(storedTraces.map((row) => row.name)).toEqual(['create_item', 'finish']);
    expect(storedTraces[0]!.messageId).toBe(storedAssistant.id);
  });

  it('创建提醒时保留 Asia/Shanghai 的绝对时间', async () => {
    // given：模型把两小时后换算成 +08:00
    ctx.faux.setResponses([
      finishWith(
        [
          {
            name: 'create_item',
            args: {
              title: '去游泳',
              kind: 'reminder',
              dueAt: '2026-11-08T12:00:00+08:00',
            },
          },
        ],
        { reply: '今天 12:00 提醒你去游泳' },
      ),
    ]);

    // when
    const response = await sendMessage(ctx, auth.token, '提醒我两个小时后去游泳');

    // then：dueAt 以 UTC 存储
    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({
      kind: 'reminder',
      dueAt: '2026-11-08T04:00:00.000Z',
    });
  });
});

describe('场景：Agent · 临时 id 与连续修改', () => {
  let ctx: TestContext;
  let auth: Authed;

  beforeEach(async () => {
    ctx = await createTestApp();
    auth = await login(ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('同一次运行内可创建后按临时 id 修改并完成', async () => {
    // given：create 返回 new_1，随后 update、complete 都引用它
    ctx.faux.setResponses([
      finishWith(
        [
          {
            name: 'create_item',
            args: {
              title: '游泳',
              kind: 'reminder',
              dueAt: '2026-11-08T20:00:00+08:00',
            },
          },
          { name: 'update_item', args: { itemId: 'new_1', title: '去游泳' } },
          { name: 'complete_item', args: { itemId: 'new_1' } },
        ],
        { reply: '已创建并完成' },
      ),
    ]);

    // when
    const response = await sendMessage(ctx, auth.token, '提醒我今晚游泳，然后标记完成');

    // then：只提交最终状态
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ title: '去游泳', status: 'done' });
  });

  it('已有事项可按 id 修改并完成', async () => {
    // given：通过按钮直建创建一个待办
    const threadId = await dailyThreadId(ctx, auth.token);
    const created = await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token: auth.token,
      payload: { threadId, kind: 'todo', title: '买牛奶' },
    });
    expect(created.status).toBe(201);

    // when：对话里改标题并完成
    ctx.faux.setResponses([
      finishWith(
        [
          { name: 'update_item', args: { itemId: created.body.id, title: '买酸奶' } },
          { name: 'complete_item', args: { itemId: created.body.id } },
        ],
        { reply: '已改并完成' },
      ),
    ]);
    const response = await sendMessage(ctx, auth.token, '把买牛奶改成买酸奶，然后完成');

    // then：响应包含更新后的事项
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      id: created.body.id,
      title: '买酸奶',
      status: 'done',
    });
  });

  it('删除已有事项以 deleted 状态返回', async () => {
    // given
    const threadId = await dailyThreadId(ctx, auth.token);
    const created = await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token: auth.token,
      payload: { threadId, kind: 'todo', title: '买路餐' },
    });

    // when
    ctx.faux.setResponses([
      finishWith([{ name: 'delete_item', args: { itemId: created.body.id } }], {
        reply: '已删除',
      }),
    ]);
    const response = await sendMessage(ctx, auth.token, '删掉买路餐');

    // then
    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ id: created.body.id, status: 'deleted' });

    const list = await call(ctx, { method: 'GET', url: '/api/items', token: auth.token });
    expect(list.body.items).toHaveLength(0);
  });
});

describe('场景：Agent · 没有 finish 时整体回滚', () => {
  let ctx: TestContext;
  let auth: Authed;

  beforeEach(async () => {
    ctx = await createTestApp();
    auth = await login(ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('写操作已暂存但未 finish：不落库、退额度、删除用户消息，可用同一 clientMessageId 重试', async () => {
    // given：模型只创建、不 finish
    ctx.faux.setResponses([
      assistantWithTools([{ name: 'create_item', args: { title: '不会存在', kind: 'todo' } }]),
      textOnly('我先不提交'),
    ]);
    const clientMessageId = 'retry-message-0001';

    // when：第一次发送
    const failed = await sendMessage(ctx, auth.token, '记一下不会存在', { clientMessageId });

    // then：500、无事项、额度归零、用户消息已删除
    expect(failed.status).toBe(500);
    expect(failed.body.code).toBe('INTERNAL');
    expect(failed.body.message).toBe('Agent did not finish');
    const items = await call(ctx, { method: 'GET', url: '/api/items', token: auth.token });
    expect(items.body.items).toHaveLength(0);
    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(0);
    const threadId = await dailyThreadId(ctx, auth.token);
    const thread = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${threadId}`,
      token: auth.token,
    });
    expect(thread.body.messages).toHaveLength(0);

    // when：同 key 重试，这次正常 finish 且有产出
    ctx.faux.setResponses([finishOnly({ reply: '好的' })]);
    const retried = await sendMessage(ctx, auth.token, '记一下不会存在', { clientMessageId });

    // then：成功且只扣一次
    expect(retried.status).toBe(200);
    const usageAfter = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usageAfter.body.used).toBe(1);
  });
});

describe('场景：Agent · 工具参数错误', () => {
  let ctx: TestContext;
  let auth: Authed;

  beforeEach(async () => {
    ctx = await createTestApp();
    auth = await login(ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('reminder 缺少 dueAt 时工具报错、不创建事项，finish 仍可提交空结果', async () => {
    // given：模型给了非法参数
    ctx.faux.setResponses([
      finishWith([{ name: 'create_item', args: { title: '游泳', kind: 'reminder' } }], {
        reply: '需要具体时间',
      }),
    ]);

    // when
    const response = await sendMessage(ctx, auth.token, '提醒我游泳');

    // then：运行成功，但工具轨迹记录了错误
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(0);
    const createTrace = response.body.toolCalls.find(
      (trace: { name: string }) => trace.name === 'create_item',
    );
    expect(createTrace).toBeDefined();
    expect(createTrace.result.error).toContain('reminder requires dueAt');
  });

  it('修改不属于当前用户的事项只会得到工具错误，不泄漏也不修改', async () => {
    // given：另一个用户有一条事项
    const other = await login(ctx, 'other@example.com', 'secret123');
    const otherThread = await dailyThreadId(ctx, other.token);
    const otherItem = await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token: other.token,
      payload: { threadId: otherThread, kind: 'todo', title: '别人的事项' },
    });
    ctx.faux.setResponses([
      finishWith([{ name: 'update_item', args: { itemId: otherItem.body.id, title: '被改' } }], {
        reply: '找不到这条',
      }),
    ]);

    // when：当前用户尝试修改
    const response = await sendMessage(ctx, auth.token, '把别人的事项改掉');

    // then：工具报错，事项保持原样
    expect(response.status).toBe(200);
    const updateTrace = response.body.toolCalls.find(
      (trace: { name: string }) => trace.name === 'update_item',
    );
    expect(updateTrace.result.error).toContain('Item not found');
    const list = await call(ctx, { method: 'GET', url: '/api/items', token: other.token });
    expect(list.body.items[0].title).toBe('别人的事项');
  });
});

describe('场景：Agent · 搜索事项', () => {
  let ctx: TestContext;
  let auth: Authed;

  beforeEach(async () => {
    ctx = await createTestApp();
    auth = await login(ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('search_items 只返回当前用户的事项', async () => {
    // given：两个用户各有同名事项
    const myThread = await dailyThreadId(ctx, auth.token);
    await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token: auth.token,
      payload: { threadId: myThread, kind: 'todo', title: '买牛奶' },
    });
    const other = await login(ctx, 'other@example.com', 'secret123');
    const otherThread = await dailyThreadId(ctx, other.token);
    await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token: other.token,
      payload: { threadId: otherThread, kind: 'todo', title: '买牛奶' },
    });

    // when：当前用户搜索
    ctx.faux.setResponses([
      finishWith([{ name: 'search_items', args: { query: '牛奶' } }], { reply: '找到一条' }),
    ]);
    const response = await sendMessage(ctx, auth.token, '我之前记的买牛奶是哪条');

    // then：只看到自己的
    expect(response.status).toBe(200);
    const searchTrace = response.body.toolCalls.find(
      (trace: { name: string }) => trace.name === 'search_items',
    );
    expect(searchTrace.result.items).toHaveLength(1);
    expect(searchTrace.result.items[0].title).toBe('买牛奶');
    const all = await call(ctx, { method: 'GET', url: '/api/items', token: auth.token });
    expect(all.body.items).toHaveLength(1);
  });
});

describe('场景：Agent · 会议纪要', () => {
  let ctx: TestContext;
  let auth: Authed;

  beforeEach(async () => {
    ctx = await createTestApp();
    auth = await login(ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('长文本返回 title/summary/keyPoints/actions，不自动创建事项，并补齐会议标题', async () => {
    // given：一个默认标题的会议 thread
    const meeting = await createMeeting(ctx, auth.token);
    expect(meeting.title).toBe('新会议');
    ctx.faux.setResponses([
      finishOnly({
        title: '产品周会',
        summary: '讨论了 v1 上线时间和通知方案。',
        keyPoints: ['11 月 20 日上线', '通知先做 iOS 本地通知', 'Web 先做页面内提示'],
        actions: [
          {
            title: '整理上线清单',
            owner: '张三',
            dueAt: '2026-11-09T10:00:00+08:00',
            evidence: '张三：我明天把清单发出来',
          },
        ],
        reply: '已整理会议纪要，候选待办待确认。',
      }),
    ]);

    // when：发送会议长文本
    const response = await sendMessage(ctx, auth.token, '会议记录：今天讨论了上线时间……', {
      threadId: meeting.id,
    });

    // then：结构化输出、无自动事项
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(0);
    expect(response.body.assistantMessage.payload).toMatchObject({
      title: '产品周会',
      summary: '讨论了 v1 上线时间和通知方案。',
      keyPoints: ['11 月 20 日上线', '通知先做 iOS 本地通知', 'Web 先做页面内提示'],
      actions: [{ title: '整理上线清单', owner: '张三' }],
    });
    const items = await call(ctx, { method: 'GET', url: '/api/items', token: auth.token });
    expect(items.body.items).toHaveLength(0);

    // then：默认会议标题被首条 payload 标题补齐
    const detail = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${meeting.id}`,
      token: auth.token,
    });
    expect(detail.body.thread.title).toBe('产品周会');
    expect(detail.body.messages).toHaveLength(2);
  });

  it('用户自定义的会议标题不会被 payload 覆盖', async () => {
    // given：显式标题
    const meeting = await createMeeting(ctx, auth.token, '周会记录');
    ctx.faux.setResponses([finishOnly({ title: '产品周会', reply: '已整理' })]);

    // when
    await sendMessage(ctx, auth.token, '会议记录……', { threadId: meeting.id });

    // then
    const detail = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${meeting.id}`,
      token: auth.token,
    });
    expect(detail.body.thread.title).toBe('周会记录');
  });
});

describe('场景：Agent · 未配置模型 key', () => {
  it('消息请求返回清晰的 500，且不扣额度、不保留用户消息', async () => {
    // given：app 没有 DEEPSEEK_API_KEY
    const ctx = await createTestApp({ apiKey: null });
    const auth = await login(ctx);

    // when
    const response = await sendMessage(ctx, auth.token, '记一下明天买牛奶');

    // then
    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL');
    expect(response.body.message).toContain('DEEPSEEK_API_KEY');
    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(0);
    const threadId = await dailyThreadId(ctx, auth.token);
    const thread = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${threadId}`,
      token: auth.token,
    });
    expect(thread.body.messages).toHaveLength(0);
    await ctx.close();
  });
});

describe('场景：Agent · finish 幂等与混合批次', () => {
  let ctx: TestContext;
  let auth: Authed;

  beforeEach(async () => {
    ctx = await createTestApp();
    auth = await login(ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('重复调用 finish 返回第一次提交的结果', async () => {
    // given：同一批次里 finish 被调用两次
    ctx.faux.setResponses([
      assistantWithTools([
        { name: 'finish', args: { reply: '第一次结果' } },
        { name: 'finish', args: { reply: '第二次结果' } },
      ]),
    ]);

    // when
    const response = await sendMessage(ctx, auth.token, '随便说点什么');

    // then：只保留第一次结果
    expect(response.status).toBe(200);
    expect(response.body.assistantMessage.payload.reply).toBe('第一次结果');
  });

  it('完全空的 finish 被拒绝，补一次有效 finish 后成功', async () => {
    // given：第一次 finish 什么内容都没有，第二次补上 reply
    ctx.faux.setResponses([
      assistantWithTools([{ name: 'finish', args: {} }]),
      finishOnly({ reply: '已补上结果' }),
    ]);

    // when
    const response = await sendMessage(ctx, auth.token, '你好');

    // then：第一次 finish 报错，第二次成功提交
    expect(response.status).toBe(200);
    const finishTraces = response.body.toolCalls.filter(
      (trace: { name: string }) => trace.name === 'finish',
    );
    expect(finishTraces).toHaveLength(2);
    expect(finishTraces[0].result.error).toContain('finish requires at least one non-empty field');
    expect(finishTraces[1].result.finished).toBe(true);
    expect(response.body.assistantMessage.payload.reply).toBe('已补上结果');
  });

  it('finish 不在批次最后也会提交并结束，之后的写操作被拒绝', async () => {
    // given：create → finish → 再次 create
    ctx.faux.setResponses([
      assistantWithTools([
        { name: 'create_item', args: { title: '提交前创建', kind: 'todo' } },
        { name: 'finish', args: { reply: '已提交' } },
        { name: 'create_item', args: { title: '提交后创建', kind: 'todo' } },
      ]),
    ]);

    // when
    const response = await sendMessage(ctx, auth.token, '记一下提交前创建');

    // then：只提交 finish 之前的写入，运行仍然成功
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].title).toBe('提交前创建');
    const lastTrace = response.body.toolCalls.at(-1);
    expect(lastTrace.name).toBe('create_item');
    expect(lastTrace.result.error).toContain('finish has already been called');
  });
});

describe('场景：Agent · 指代不清先提问', () => {
  let ctx: TestContext;
  let auth: Authed;

  beforeEach(async () => {
    ctx = await createTestApp();
    auth = await login(ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('只 finish.reply 提问，不创建或修改任何事项', async () => {
    // given：用户此前有两条相似事项
    const threadId = await dailyThreadId(ctx, auth.token);
    for (const title of ['买牛奶', '买酸奶']) {
      await call(ctx, {
        method: 'POST',
        url: '/api/items',
        token: auth.token,
        payload: { threadId, kind: 'todo', title },
      });
    }
    ctx.faux.setResponses([
      finishOnly({ reply: '你是指「买牛奶」还是「买酸奶」？' }),
    ]);

    // when：用户说「删掉那个」
    const response = await sendMessage(ctx, auth.token, '删掉那个');

    // then：只提问，不改数据
    expect(response.status).toBe(200);
    expect(response.body.assistantMessage.payload.reply).toBe(
      '你是指「买牛奶」还是「买酸奶」？',
    );
    expect(response.body.items).toHaveLength(0);
    const items = await call(ctx, { method: 'GET', url: '/api/items', token: auth.token });
    expect(items.body.items).toHaveLength(2);
  });
});

describe('场景：Agent · 按 thread 搜索事项', () => {
  let ctx: TestContext;
  let auth: Authed;

  beforeEach(async () => {
    ctx = await createTestApp();
    auth = await login(ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('search_items 的 threadId 过滤生效', async () => {
    // given：日常和会议各一条同名事项
    const daily = await dailyThreadId(ctx, auth.token);
    const meeting = await createMeeting(ctx, auth.token);
    for (const threadId of [daily, meeting.id]) {
      await call(ctx, {
        method: 'POST',
        url: '/api/items',
        token: auth.token,
        payload: { threadId, kind: 'todo', title: '整理清单' },
      });
    }

    // when：只搜索会议 thread
    ctx.faux.setResponses([
      finishWith([{ name: 'search_items', args: { query: '清单', threadId: meeting.id } }], {
        reply: '找到一条',
      }),
    ]);
    const response = await sendMessage(ctx, auth.token, '这个会议里的清单是哪条', {
      threadId: meeting.id,
    });

    // then
    const trace = response.body.toolCalls.find(
      (item: { name: string }) => item.name === 'search_items',
    );
    expect(trace.result.items).toHaveLength(1);
    expect(trace.result.items[0].threadId).toBe(meeting.id);
  });
});


describe('场景：Agent · 持久化失败整体回滚', () => {
  let ctx: TestContext;
  let auth: Authed;

  beforeEach(async () => {
    ctx = await createTestApp();
    auth = await login(ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('assistant 落库失败时事项、消息和额度一起回滚', async () => {
    // given：制造 assistant 插入失败，模型会先创建事项再 finish
    ctx.app.sqlite.exec(`
      CREATE TRIGGER fail_assistant_insert
      BEFORE INSERT ON messages
      WHEN NEW.role = 'assistant'
      BEGIN
        SELECT RAISE(ABORT, 'forced assistant failure');
      END;
    `);
    ctx.faux.setResponses([
      finishWith(
        [{ name: 'create_item', args: { title: '不应存在', kind: 'todo' } }],
        { reply: '已处理' },
      ),
    ]);

    // when
    const response = await sendMessage(ctx, auth.token, '记一下不应存在');

    // then：事务回滚，额度退回，用户消息也不留下
    expect(response.status).toBe(500);
    const items = await call(ctx, { method: 'GET', url: '/api/items', token: auth.token });
    expect(items.body.items).toHaveLength(0);
    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(0);
    const threadId = await dailyThreadId(ctx, auth.token);
    const thread = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${threadId}`,
      token: auth.token,
    });
    expect(thread.body.messages).toHaveLength(0);
  });
});


describe('场景：Agent · 历史消息保留纪要上下文', () => {
  it('assistant 历史会把摘要、重点和候选事项带回模型', () => {
    const row: MessageRow = {
      id: 'assistant-history',
      threadId: 'thread-history',
      role: 'assistant',
      content: '已整理会议',
      payloadJson: JSON.stringify({
        title: '产品周会',
        summary: '确认报价分工。',
        keyPoints: ['小李交报价'],
        actions: [
          { title: '提交报价', owner: '小李', dueAt: '2026-11-13T18:00:00+08:00' },
        ],
        reply: '已整理',
      }),
      clientMessageId: null,
      userMessageId: 'user-history',
      responseJson: null,
      createdAt: '2026-11-08T02:00:00.000Z',
    };
    const history = formatAssistantHistory(row);
    expect(history).toContain('摘要：确认报价分工。');
    expect(history).toContain('0. 提交报价');
    expect(history).toContain('负责人=小李');
  });

  it('长摘要不会把候选事项截掉', () => {
    const row: MessageRow = {
      id: 'assistant-long-summary',
      threadId: 'thread-history',
      role: 'assistant',
      content: '已整理会议',
      payloadJson: JSON.stringify({
        summary: '长'.repeat(5000),
        actions: [{ title: '提交报价' }],
      }),
      clientMessageId: null,
      userMessageId: 'user-history',
      responseJson: null,
      createdAt: '2026-11-08T02:00:00.000Z',
    };
    const history = formatAssistantHistory(row);
    expect(history).toContain('0. 提交报价');
    expect(history.length).toBeLessThanOrEqual(4000);
  });
});


describe('场景：Agent · 执行时间', () => {
  it('create_item 带上 scheduledAt，finish 的候选也能带执行时间', async () => {
    const ctx = await createTestApp();
    try {
      const auth = await login(ctx);
      ctx.faux.setResponses([
        finishWith(
          [
            {
              name: 'create_item',
              args: {
                title: '改原型',
                kind: 'todo',
                dueAt: '2026-11-13T23:59:00+08:00',
                scheduledAt: '2026-11-12T09:30:00+08:00',
              },
            },
          ],
          {
            reply: '已记录',
            actions: [
              {
                title: '周五前给报价单',
                dueAt: '2026-11-13T23:59:00+08:00',
                scheduledAt: '2026-11-12T10:00:00+08:00',
              },
            ],
          },
        ),
      ]);

      const response = await sendMessage(ctx, auth.token, '记一下：改原型，12 号上午九点半开始，13 号前交');

      expect(response.status).toBe(200);
      expect(response.body.items[0]).toMatchObject({
        title: '改原型',
        dueAt: '2026-11-13T15:59:00.000Z',
        scheduledAt: '2026-11-12T01:30:00.000Z',
      });
      expect(response.body.assistantMessage.payload.actions[0]).toMatchObject({
        title: '周五前给报价单',
        scheduledAt: '2026-11-12T10:00:00+08:00',
      });
    } finally {
      await ctx.close();
    }
  });
});
