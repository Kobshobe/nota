import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { usageDaily, usageEvents, users } from '../src/db/schema';
import { reapExpiredReservations, reserveQuota } from '../src/quota';
import {
  call,
  createTestApp,
  finishOnly,
  login,
  sendMessage,
  type TestContext,
} from './helpers';

describe('场景：额度账本', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx.close();
  });

  it('只回一句话的运行也算一次，账本转成 committed', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    ctx.faux.setResponses([finishOnly({ reply: '什么时候开始？' })]);

    const response = await sendMessage(ctx, auth.token, '提醒我一会去游泳');
    expect(response.status).toBe(200);

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(1);

    const events = ctx.app.db.select().from(usageEvents).all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ state: 'committed', releaseReason: null });
  });

  it('会议纪要没有事项但有 summary，照常计费一次', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    ctx.faux.setResponses([
      finishOnly({
        title: '产品周会',
        summary: '报价下调两千。',
        keyPoints: ['李工周四前给原型'],
        reply: '已整理',
      }),
    ]);

    const response = await sendMessage(ctx, auth.token, '会议记录：……');
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(0);

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(1);

    const events = ctx.app.db.select().from(usageEvents).all();
    expect(events[0]).toMatchObject({ state: 'committed', releaseReason: null });
  });

  it('计数器始终等于账本里未被释放的行数', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);

    ctx.faux.setResponses([finishOnly({ reply: '好的' })]);
    await sendMessage(ctx, auth.token, '记一下买牛奶');
    ctx.faux.setResponses([finishOnly({ reply: '好的' })]);
    await sendMessage(ctx, auth.token, '记一下买酸奶');
    ctx.faux.setResponses([finishOnly({ reply: '你指的是哪一个？' })]);
    await sendMessage(ctx, auth.token, '删掉那个');

    const events = ctx.app.db.select().from(usageEvents).all();
    const derived = events.filter((event) => event.state !== 'released').length;
    const rows = ctx.app.db.select().from(usageDaily).all();
    const counted = rows.reduce((total, row) => total + row.used, 0);

    expect(derived).toBe(3);
    expect(counted).toBe(derived);
  });

  it('清扫把超期未结账的占用退回', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    const owner = ctx.app.db.select().from(users).where(eq(users.email, auth.user.email)).get();
    if (!owner) throw new Error('user missing');

    reserveQuota(ctx.app.db, owner, ctx.app.config, ctx.currentNow, {
      idempotencyKey: 'stale-reservation-1',
      reason: 'message',
    });
    const before = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(before.body.used).toBe(1);

    const later = new Date(ctx.currentNow.getTime() + 3 * 60_000);
    const released = reapExpiredReservations(ctx.app.db, later, ctx.app.config.quotaReserveTtlMinutes);
    expect(released).toBe(1);

    const after = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(after.body.used).toBe(0);
    const events = ctx.app.db.select().from(usageEvents).all();
    expect(events[0]).toMatchObject({ state: 'released', releaseReason: 'stale' });
  });

  it('结账时账本已被清扫释放，不再加计数也不报错', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    const owner = ctx.app.db.select().from(users).where(eq(users.email, auth.user.email)).get();
    if (!owner) throw new Error('user missing');

    reserveQuota(ctx.app.db, owner, ctx.app.config, ctx.currentNow, {
      idempotencyKey: 'stale-reservation-2',
      reason: 'message',
    });
    const later = new Date(ctx.currentNow.getTime() + 3 * 60_000);
    expect(reapExpiredReservations(ctx.app.db, later, 2)).toBe(1);

    // 第二次清扫没有可回收的行，计数不会被退第二次。
    expect(reapExpiredReservations(ctx.app.db, later, 2)).toBe(0);
    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(0);
  });
});
