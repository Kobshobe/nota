import { afterEach, describe, expect, it } from 'vitest';
import {
  call,
  createTestApp,
  finishOnly,
  login,
  textOnly,
  sendMessage,
  type TestContext,
} from './helpers';

describe('场景：额度 · 最近一条可疑扣费自查', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx.close();
  });

  it('失败的运行留下已退回的记录', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    ctx.faux.setResponses([
      finishOnly({ reply: '已记录' }),
      textOnly('我随便说点什么，但不会调用 finish'),
    ]);
    await sendMessage(ctx, auth.token, '记一下买牛奶');
    expect((await sendMessage(ctx, auth.token, '提醒我一会去游泳')).status).toBe(500);

    const check = await call(ctx, {
      method: 'GET',
      url: '/api/usage/last-anomaly',
      token: auth.token,
    });
    expect(check.status).toBe(200);
    expect(check.body.state).toBe('released');
    expect(check.body.message).toContain('已经退回');
  });

  it('只返回最新的一条，跳过早先的', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    ctx.faux.setResponses([
      textOnly('不会调用 finish'),
      finishOnly({ reply: '已记录' }),
    ]);
    expect((await sendMessage(ctx, auth.token, '提醒我一会去游泳')).status).toBe(500);
    await sendMessage(ctx, auth.token, '两个小时后');

    // 最后一条正常计费，所以最近一条可疑记录是更早那次
    const check = await call(ctx, {
      method: 'GET',
      url: '/api/usage/last-anomaly',
      token: auth.token,
    });
    expect(check.body.state).toBe('released');
  });

  it('全都正常计费时返回 none', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    ctx.faux.setResponses([finishOnly({ reply: '已记录' })]);
    await sendMessage(ctx, auth.token, '记一下买牛奶');

    const check = await call(ctx, {
      method: 'GET',
      url: '/api/usage/last-anomaly',
      token: auth.token,
    });
    expect(check.body.state).toBe('none');
    expect(check.body.message).toContain('没有发现');
  });

  it('别的用户看不到我的记录', async () => {
    ctx = await createTestApp();
    const owner = await login(ctx);
    ctx.faux.setResponses([textOnly('不会调用 finish')]);
    expect((await sendMessage(ctx, owner.token, '提醒我一会去游泳')).status).toBe(500);

    const other = await login(ctx, 'other@example.com');
    const check = await call(ctx, {
      method: 'GET',
      url: '/api/usage/last-anomaly',
      token: other.token,
    });
    expect(check.body.state).toBe('none');
  });
});
