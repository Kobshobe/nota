import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  createTestApp,
  dailyThreadId,
  finishOnly,
  login,
  sendMessage,
  type TestContext,
} from './helpers';

async function sendOk(ctx: TestContext, token: string, content: string) {
  ctx.faux.setResponses([finishOnly({ reply: '好的' })]);
  const response = await sendMessage(ctx, token, content);
  expect(response.status).toBe(200);
  return response;
}

describe('场景：额度 · Free 第 11 次被拒', () => {
  let ctx: TestContext;
  let token: string;

  beforeEach(async () => {
    ctx = await createTestApp({ dailyLimit: 10 });
    token = (await login(ctx)).token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('前 10 次成功，第 11 次返回 429 QUOTA_EXCEEDED 与 Retry-After', async () => {
    // given：Free 用户当天已发 10 条消息
    for (let index = 0; index < 10; index += 1) {
      await sendOk(ctx, token, `第 ${index + 1} 次记录`);
    }

    // when：第 11 次提交
    const response = await sendMessage(ctx, token, '第 11 次记录');

    // then：被拒绝并给出重置信息
    expect(response.status).toBe(429);
    expect(response.body.code).toBe('QUOTA_EXCEEDED');
    expect(response.body.details).toMatchObject({ used: 10, limit: 10, date: '2026-11-08' });
    const retryAfter = Number(response.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);

    // then：拒绝不额外扣额度
    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token });
    expect(usage.body.used).toBe(10);
  });

  it('额度在 Asia/Shanghai 日界重置', async () => {
    // given：11 月 8 日 23:59（上海）
    ctx.setNow(new Date('2026-11-08T23:59:00+08:00'));
    for (let index = 0; index < 10; index += 1) {
      await sendOk(ctx, token, `当天第 ${index + 1} 次`);
    }
    const exhausted = await sendMessage(ctx, token, '当天第 11 次');
    expect(exhausted.status).toBe(429);
    expect(exhausted.body.details.date).toBe('2026-11-08');

    // when：跨过上海午夜
    ctx.setNow(new Date('2026-11-09T00:01:00+08:00'));
    await sendOk(ctx, token, '新的一天第一次');

    // then：新的一天重新计算
    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token });
    expect(usage.body.used).toBe(1);
    expect(usage.body.date).toBe('2026-11-09');
    expect(usage.body.resetsAt).toBe('2026-11-09T16:00:00.000Z');
  });
});

describe('场景：额度 · VIP 不限次', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ dailyLimit: 10 });
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('VIP 用户超过 10 次仍然成功，usage 标记 unlimited', async () => {
    // given：VIP 用户
    const token = (await login(ctx, 'vip@example.com')).token;

    // when：连续发送 12 条
    for (let index = 0; index < 12; index += 1) {
      await sendOk(ctx, token, `VIP 第 ${index + 1} 次`);
    }

    // then：没有 429
    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token });
    expect(usage.body).toMatchObject({ used: 12, limit: 10, unlimited: true });
  });
});

describe('场景：额度 · 按钮直建不扣额度', () => {
  let ctx: TestContext;
  let token: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    token = (await login(ctx)).token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('POST /items 与后续修改、完成、删除都不增加已用次数', async () => {
    // given：日常 thread
    const threadId = await dailyThreadId(ctx, token);

    // when：按钮直建事项
    const created = await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token,
      payload: { threadId, kind: 'todo', title: '按钮创建' },
    });
    expect(created.status).toBe(201);

    // when：修改、完成、删除
    const updated = await call(ctx, {
      method: 'PATCH',
      url: `/api/items/${created.body.id}`,
      token,
      payload: { title: '按钮修改' },
    });
    expect(updated.status).toBe(200);
    const completed = await call(ctx, {
      method: 'POST',
      url: `/api/items/${created.body.id}/complete`,
      token,
      payload: {},
    });
    expect(completed.status).toBe(200);
    const deleted = await call(ctx, {
      method: 'DELETE',
      url: `/api/items/${created.body.id}`,
      token,
    });
    expect(deleted.status).toBe(204);

    // then：额度始终为 0
    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token });
    expect(usage.body.used).toBe(0);
  });
});

describe('场景：额度 · 重试不重复扣', () => {
  let ctx: TestContext;
  let token: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    token = (await login(ctx)).token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('同一 clientMessageId 重试返回原响应，不再次调用模型也不加额度', async () => {
    // given：第一次发送成功
    const clientMessageId = 'idempotent-message-1';
    ctx.faux.setResponses([finishOnly({ reply: '第一次结果' })]);
    const first = await sendMessage(ctx, token, '记一下买牛奶', { clientMessageId });
    expect(first.status).toBe(200);

    // when：同 key 重试，模型队列已清空
    ctx.faux.setResponses([]);
    const retried = await sendMessage(ctx, token, '记一下买牛奶', { clientMessageId });

    // then：返回完全相同的消息，额度只扣一次
    expect(retried.status).toBe(200);
    expect(retried.body.assistantMessage.id).toBe(first.body.assistantMessage.id);
    expect(retried.body.assistantMessage.payload.reply).toBe('第一次结果');
    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token });
    expect(usage.body.used).toBe(1);

    const threadId = await dailyThreadId(ctx, token);
    const detail = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${threadId}`,
      token,
    });
    expect(detail.body.messages).toHaveLength(2);
  });

  it('并发提交同一 clientMessageId 只调用一次模型并只扣一次额度', async () => {
    // given：同一个 key 的两个请求同时到达
    const threadId = await dailyThreadId(ctx, token);
    const clientMessageId = 'concurrent-message-1';
    ctx.faux.setResponses([finishOnly({ reply: '并发结果' })]);

    // when
    const [first, second] = await Promise.all([
      sendMessage(ctx, token, '并发记一下', { threadId, clientMessageId }),
      sendMessage(ctx, token, '并发记一下', { threadId, clientMessageId }),
    ]);

    // then：两个响应一致，模型只跑一次，额度只扣一次
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.assistantMessage.id).toBe(first.body.assistantMessage.id);
    expect(ctx.faux.state.callCount).toBe(1);
    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token });
    expect(usage.body.used).toBe(1);
  });
});
