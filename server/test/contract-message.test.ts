import { afterEach, describe, expect, it } from 'vitest';
import {
  call,
  finishOnly,
  createTestApp,
  dailyThreadId,
  finishWith,
  login,
  sendMessage,
  type TestContext,
} from './helpers';

describe('场景：运行时契约 · 消息与候选事项', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx.close();
  });

  it('SendMessageResponse、工具轨迹和候选来源字段与契约一致', async () => {
    ctx = await createTestApp();
    const token = (await login(ctx)).token;
    ctx.faux.setResponses([
      finishWith(
        [{ name: 'create_item', args: { title: '准备周报', kind: 'todo' } }],
        {
          reply: '已整理',
          summary: '确认了周报分工。',
          keyPoints: ['周报由我准备'],
          actions: [{ title: '准备周报', owner: '我' }],
        },
      ),
    ]);

    const response = await sendMessage(ctx, token, '整理一下');
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual([
      'assistantMessage',
      'items',
      'toolCalls',
      'usage',
      'userMessage',
    ]);
    expect(response.body.assistantMessage.payload.summary).toBe('确认了周报分工。');
    expect(response.body.toolCalls.map((trace: { name: string }) => trace.name)).toEqual([
      'create_item',
      'finish',
    ]);

    const threadId = await dailyThreadId(ctx, token);
    const thread = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${threadId}`,
      token,
    });
    const assistant = thread.body.messages.find((message: { role: string }) => message.role === 'assistant');
    expect(assistant.toolCalls.map((trace: { name: string }) => trace.name)).toEqual([
      'create_item',
      'finish',
    ]);

    const created = await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token,
      payload: {
        threadId,
        kind: 'todo',
        title: '准备周报',
        sourceMessageId: assistant.id,
        candidateIndex: 0,
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      sourceMessageId: assistant.id,
      candidateIndex: 0,
      title: '准备周报',
    });
    const items = await call(ctx, { method: 'GET', url: `/api/items?threadId=${threadId}`, token });
    const linked = items.body.items.find((item: { sourceMessageId?: string }) => item.sourceMessageId === assistant.id);
    expect(linked.candidateIndex).toBe(0);
  });

  it('第 11 次消息返回 429 和 Retry-After', async () => {
    ctx = await createTestApp({ dailyLimit: 1 });
    const token = (await login(ctx)).token;
    ctx.faux.setResponses([finishOnly({ reply: '第一次' }), finishOnly({ reply: '第二次' })]);
    const first = await sendMessage(ctx, token, '第一条');
    const second = await sendMessage(ctx, token, '第二条');

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('QUOTA_EXCEEDED');
    expect(Number(second.headers['retry-after'])).toBeGreaterThan(0);
  });
});
