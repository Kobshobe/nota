import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  createMeeting,
  createTestApp,
  dailyThreadId,
  login,
  type TestContext,
} from './helpers';

describe('场景：事项 · 直接创建与校验', () => {
  let ctx: TestContext;
  let token: string;
  let threadId: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    token = (await login(ctx)).token;
    threadId = await dailyThreadId(ctx, token);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('创建待办返回 201 契约字段，不扣额度', async () => {
    // when
    const response = await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token,
      payload: { threadId, kind: 'todo', title: '买牛奶' },
    });

    // then
    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual([
      'createdAt',
      'id',
      'kind',
      'status',
      'threadId',
      'title',
      'updatedAt',
    ]);
    expect(response.body).toMatchObject({
      threadId,
      kind: 'todo',
      title: '买牛奶',
      status: 'open',
    });
    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token });
    expect(usage.body.used).toBe(0);
  });

  it('reminder 必须有 dueAt，dueAt 统一存 UTC', async () => {
    // when：缺少 dueAt
    const missing = await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token,
      payload: { threadId, kind: 'reminder', title: '去游泳' },
    });

    // then
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('INVALID_INPUT');
    expect(missing.body.details).toHaveProperty('dueAt');

    // when：带 +08:00 时间
    const created = await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token,
      payload: {
        threadId,
        kind: 'reminder',
        title: '去游泳',
        dueAt: '2026-11-08T20:00:00+08:00',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.dueAt).toBe('2026-11-08T12:00:00.000Z');
  });

  it('非法 kind、空标题、非法 dueAt、多余字段返回 400', async () => {
    const cases = [
      { threadId, kind: 'meeting', title: 'x' },
      { threadId, kind: 'todo', title: '' },
      { threadId, kind: 'todo', title: 'x', dueAt: 'tomorrow' },
      { threadId, kind: 'todo', title: 'x', extra: 1 },
    ];
    for (const payload of cases) {
      const response = await call(ctx, { method: 'POST', url: '/api/items', token, payload });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_INPUT');
    }
  });

  it('不属于当前用户的 thread 创建事项返回 404', async () => {
    const other = await login(ctx, 'other@example.com');
    const otherThread = await dailyThreadId(ctx, other.token);
    const response = await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token,
      payload: { threadId: otherThread, kind: 'todo', title: '越权' },
    });
    expect(response.status).toBe(404);
  });
});

describe('场景：事项 · 列表筛选与状态', () => {
  let ctx: TestContext;
  let token: string;
  let threadId: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    token = (await login(ctx)).token;
    threadId = await dailyThreadId(ctx, token);
  });

  afterEach(async () => {
    await ctx.close();
  });

  async function create(title: string) {
    const response = await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token,
      payload: { threadId, kind: 'todo', title },
    });
    expect(response.status).toBe(201);
    return response.body as { id: string; status: string };
  }

  it('列表按状态、threadId、limit 筛选，默认排除 deleted', async () => {
    // given：三条事项，一条完成、一条删除
    const open = await create('待办 A');
    const done = await create('待办 B');
    const deleted = await create('待办 C');
    await call(ctx, {
      method: 'POST',
      url: `/api/items/${done.id}/complete`,
      token,
      payload: {},
    });
    await call(ctx, { method: 'DELETE', url: `/api/items/${deleted.id}`, token });

    // when / then：默认列表
    const all = await call(ctx, { method: 'GET', url: '/api/items', token });
    expect(all.body.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [open.id, done.id].sort(),
    );

    // 状态筛选
    const openOnly = await call(ctx, { method: 'GET', url: '/api/items?status=open', token });
    expect(openOnly.body.items.map((item: { id: string }) => item.id)).toEqual([open.id]);
    const doneOnly = await call(ctx, { method: 'GET', url: '/api/items?status=done', token });
    expect(doneOnly.body.items.map((item: { id: string }) => item.id)).toEqual([done.id]);

    // thread 筛选
    const meeting = await createMeeting(ctx, token);
    const otherThread = await call(ctx, {
      method: 'GET',
      url: `/api/items?threadId=${meeting.id}`,
      token,
    });
    expect(otherThread.body.items).toEqual([]);

    // limit
    const limited = await call(ctx, { method: 'GET', url: '/api/items?limit=1', token });
    expect(limited.body.items).toHaveLength(1);
  });

  it('PATCH 修改标题和 dueAt，complete 标记完成', async () => {
    // given
    const item = await create('原标题');

    // when
    const updated = await call(ctx, {
      method: 'PATCH',
      url: `/api/items/${item.id}`,
      token,
      payload: { title: '新标题', dueAt: '2026-11-09T09:30:00+08:00' },
    });
    const completed = await call(ctx, {
      method: 'POST',
      url: `/api/items/${item.id}/complete`,
      token,
      payload: {},
    });

    // then
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      title: '新标题',
      dueAt: '2026-11-09T01:30:00.000Z',
    });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ status: 'done', title: '新标题' });
  });

  it('空 PATCH 返回 400，删除返回 204 且之后不再出现在列表', async () => {
    // given
    const item = await create('待删除');

    // when
    const empty = await call(ctx, {
      method: 'PATCH',
      url: `/api/items/${item.id}`,
      token,
      payload: {},
    });
    expect(empty.status).toBe(400);

    // then：删除
    const deleted = await call(ctx, { method: 'DELETE', url: `/api/items/${item.id}`, token });
    expect(deleted.status).toBe(204);
    const list = await call(ctx, { method: 'GET', url: '/api/items', token });
    expect(list.body.items).toHaveLength(0);
  });
});

describe('场景：事项 · 归属隔离', () => {
  let ctx: TestContext;
  let alice: string;
  let bob: string;
  let itemId: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    alice = (await login(ctx, 'alice@example.com')).token;
    bob = (await login(ctx, 'bob@example.com')).token;
    const threadId = await dailyThreadId(ctx, alice);
    const created = await call(ctx, {
      method: 'POST',
      url: '/api/items',
      token: alice,
      payload: { threadId, kind: 'todo', title: 'Alice 的事项' },
    });
    itemId = created.body.id;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('其他用户修改、完成、删除都返回 404', async () => {
    const patch = await call(ctx, {
      method: 'PATCH',
      url: `/api/items/${itemId}`,
      token: bob,
      payload: { title: '被改' },
    });
    const complete = await call(ctx, {
      method: 'POST',
      url: `/api/items/${itemId}/complete`,
      token: bob,
      payload: {},
    });
    const remove = await call(ctx, { method: 'DELETE', url: `/api/items/${itemId}`, token: bob });

    expect(patch.status).toBe(404);
    expect(complete.status).toBe(404);
    expect(remove.status).toBe(404);

    const aliceList = await call(ctx, { method: 'GET', url: '/api/items', token: alice });
    expect(aliceList.body.items[0].title).toBe('Alice 的事项');
  });

  it('列表按 threadId 查询不会泄漏其他用户的事项', async () => {
    const aliceThread = await dailyThreadId(ctx, alice);
    const response = await call(ctx, {
      method: 'GET',
      url: `/api/items?threadId=${aliceThread}`,
      token: bob,
    });
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });
});
