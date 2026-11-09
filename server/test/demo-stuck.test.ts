import { afterEach, describe, expect, it } from 'vitest';
import { usageDaily, usageEvents } from '../src/db/schema';
import { reapExpiredReservations } from '../src/quota';
import { call, createTestApp, finishOnly, login, sendMessage, type TestContext } from './helpers';

describe('场景：演示 · 模拟中断留下未结账的占用', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx.close();
  });

  it('消息以触发词开头时请求失败，额度保持占用', async () => {
    ctx = await createTestApp({ demoStuckPrefix: '改为八个小时后' });
    const auth = await login(ctx);
    // 队列里放一条正常响应，确认它根本没被消费
    ctx.faux.setResponses([finishOnly({ reply: '不该跑到这里' })]);

    const response = await sendMessage(ctx, auth.token, '改为八个小时后提醒我');
    expect(response.status).toBe(500);

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(1);

    const events = ctx.app.db.select().from(usageEvents).all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ state: 'reserved', releaseReason: null });
    expect(ctx.faux.state.callCount).toBe(0);
  });

  it('清扫之后额度退回去，账本标记为 stale', async () => {
    ctx = await createTestApp({ demoStuckPrefix: '改为八个小时后' });
    const auth = await login(ctx);
    await sendMessage(ctx, auth.token, '改为八个小时后提醒我');

    const released = reapExpiredReservations(
      ctx.app.db,
      new Date(ctx.currentNow.getTime() + 3 * 60_000),
      ctx.app.config.quotaReserveTtlMinutes,
    );
    expect(released).toBe(1);

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(0);

    const events = ctx.app.db.select().from(usageEvents).all();
    expect(events[0]).toMatchObject({ state: 'released', releaseReason: 'stale' });

    const check = await call(ctx, {
      method: 'GET',
      url: '/api/usage/last-anomaly',
      token: auth.token,
    });
    expect(check.body.state).toBe('released');
  });

  it('没配触发词时行为不变', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    ctx.faux.setResponses([finishOnly({ reply: '已记录' })]);

    const response = await sendMessage(ctx, auth.token, '改为八个小时后提醒我');
    expect(response.status).toBe(200);

    const rows = ctx.app.db.select().from(usageDaily).all();
    expect(rows.reduce((sum, row) => sum + row.used, 0)).toBe(1);
  });

  it('不以触发词开头的消息不受影响', async () => {
    ctx = await createTestApp({ demoStuckPrefix: '改为八个小时后' });
    const auth = await login(ctx);
    ctx.faux.setResponses([finishOnly({ reply: '已记录' })]);

    const response = await sendMessage(ctx, auth.token, '记一下买牛奶');
    expect(response.status).toBe(200);
  });
});
