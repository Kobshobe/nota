import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  createMeeting,
  createTestApp,
  dailyThreadId,
  finishOnly,
  login,
  sendMessage,
  type TestContext,
} from './helpers';

describe('场景：Thread · 列表与新建会议', () => {
  let ctx: TestContext;
  let token: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    token = (await login(ctx)).token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('登录后只有日常 thread；新建会议使用默认标题并排在前面', async () => {
    // given：登录后自动创建日常 thread
    const initial = await call(ctx, { method: 'GET', url: '/api/threads', token });
    expect(initial.body.threads).toHaveLength(1);
    expect(initial.body.threads[0].kind).toBe('daily');

    // when：新建会议 thread
    ctx.setNow(new Date('2026-11-08T11:00:00+08:00'));
    const created = await createMeeting(ctx, token);

    // then：默认标题新会议，列表按更新时间倒序
    expect(created).toMatchObject({ kind: 'meeting', title: '新会议' });
    const list = await call(ctx, { method: 'GET', url: '/api/threads', token });
    expect(list.body.threads).toHaveLength(2);
    expect(list.body.threads[0].id).toBe(created.id);
    expect(list.body.threads[1].kind).toBe('daily');
  });

  it('读取 thread 返回降序消息时间线与 payload', async () => {
    // given：一条成功消息
    ctx.faux.setResponses([finishOnly({ reply: '收到', title: '小记' })]);
    const sent = await sendMessage(ctx, token, '你好');
    const threadId = await dailyThreadId(ctx, token);

    // when
    const detail = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${threadId}`,
      token,
    });

    // then
    expect(detail.status).toBe(200);
    expect(detail.body.thread.id).toBe(threadId);
    expect(detail.body.messages).toHaveLength(2);
    expect(detail.body.messages[0].id).toBe(sent.body.userMessage.id);
    expect(detail.body.messages[1].id).toBe(sent.body.assistantMessage.id);
    expect(detail.body.messages[1].payload.reply).toBe('收到');
  });

  it('新建会议拒绝非法 kind、超长标题和多余字段', async () => {
    // when / then
    const badKind = await call(ctx, {
      method: 'POST',
      url: '/api/threads',
      token,
      payload: { kind: 'daily' },
    });
    expect(badKind.status).toBe(400);
    expect(badKind.body.code).toBe('INVALID_INPUT');

    const longTitle = await call(ctx, {
      method: 'POST',
      url: '/api/threads',
      token,
      payload: { kind: 'meeting', title: 'x'.repeat(101) },
    });
    expect(longTitle.status).toBe(400);

    const extra = await call(ctx, {
      method: 'POST',
      url: '/api/threads',
      token,
      payload: { kind: 'meeting', extra: true },
    });
    expect(extra.status).toBe(400);
  });
});

describe('场景：Thread · 归属隔离', () => {
  let ctx: TestContext;
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    alice = (await login(ctx, 'alice@example.com')).token;
    bob = (await login(ctx, 'bob@example.com')).token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('其他用户读取、发消息、直建事项都得到 404', async () => {
    // given：alice 的会议 thread
    const meeting = await createMeeting(ctx, alice, 'Alice 的会议');

    // when：bob 访问
    const read = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${meeting.id}`,
      token: bob,
    });
    const message = await sendMessage(ctx, bob, '偷看', { threadId: meeting.id });
    const item = await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token: bob,
      payload: { threadId: meeting.id, kind: 'todo', title: '越权创建' },
    });

    // then：都不暴露资源存在性
    expect(read.status).toBe(404);
    expect(read.body.code).toBe('NOT_FOUND');
    expect(message.status).toBe(404);
    expect(item.status).toBe(404);
  });

  it('thread 列表不包含其他用户的 thread', async () => {
    // given
    await createMeeting(ctx, alice, 'Alice 的会议');

    // when
    const bobList = await call(ctx, { method: 'GET', url: '/api/threads', token: bob });

    // then
    expect(bobList.body.threads).toHaveLength(1);
    expect(bobList.body.threads[0].kind).toBe('daily');
  });

  it('不存在的 thread 读取返回 404', async () => {
    const response = await call(ctx, {
      method: 'GET',
      url: '/api/threads/does-not-exist',
      token: alice,
    });
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});
