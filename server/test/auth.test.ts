import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, createTestApp, login, type TestContext } from './helpers';

describe('场景：登录 · 新邮箱自动注册', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('邮箱规范化后创建账号、日常 thread，并可读取当前用户', async () => {
    // given：一个尚未注册的邮箱，带空格和大写
    // when：首次登录
    const auth = await login(ctx, '  New@Example.COM ', 'secret123');

    // then：账号被创建、邮箱规范化、返回可用 JWT
    expect(auth.user).toEqual({ email: 'new@example.com', isVip: false });
    expect(auth.token.length).toBeGreaterThan(20);

    const me = await call(ctx, { method: 'GET', url: '/api/auth/me', token: auth.token });
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ email: 'new@example.com', isVip: false });

    const threads = await call(ctx, {
      method: 'GET',
      url: '/api/threads',
      token: auth.token,
    });
    expect(threads.status).toBe(200);
    expect(threads.body.threads).toHaveLength(1);
    expect(threads.body.threads[0]).toMatchObject({ kind: 'daily', title: '日常' });
  });

  it('签发的 JWT 使用 HS256，有效期为 7 天', async () => {
    // given：登录成功
    const auth = await login(ctx, 'jwt@example.com', 'secret123');
    const header = JSON.parse(Buffer.from(auth.token.split('.')[0]!, 'base64url').toString());
    const payload = ctx.app.jwt.decode(auth.token) as { iat: number; exp: number };

    // then：算法与时长符合契约
    expect(header.alg).toBe('HS256');
    expect(payload.exp - payload.iat).toBe(7 * 24 * 60 * 60);
  });

  it('同一邮箱忽略大小写登录已有账号', async () => {
    // given：先用大写邮箱注册
    const first = await login(ctx, 'Same@Example.com', 'secret123');
    expect(first.user.email).toBe('same@example.com');

    // when：再用小写邮箱登录
    const second = await login(ctx, 'same@example.com', 'secret123');

    // then：仍是同一个账号、同一日常 thread
    expect(second.user.email).toBe('same@example.com');
    const threads = await call(ctx, {
      method: 'GET',
      url: '/api/threads',
      token: second.token,
    });
    expect(threads.body.threads).toHaveLength(1);
  });
});

describe('场景：登录 · 已有邮箱密码校验', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('密码错误返回 401 INVALID_CREDENTIALS，不签发 token', async () => {
    // given：邮箱已注册
    await login(ctx, 'user@example.com', 'secret123');

    // when：使用错误密码登录
    const response = await call(ctx, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user@example.com', password: 'wrong-password' },
    });

    // then：统一凭据错误
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect',
    });
    expect(response.body.requestId).toMatch(/^req_/);
    expect(response.body.token).toBeUndefined();
  });
});

describe('场景：JWT · 鉴权', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('缺少或伪造 token 返回 401 UNAUTHORIZED', async () => {
    // given：受保护接口
    const noToken = await call(ctx, { method: 'GET', url: '/api/auth/me' });
    const badToken = await call(ctx, {
      method: 'GET',
      url: '/api/auth/me',
      token: 'not-a-real-token',
    });

    // then：都映射为统一未授权错误
    expect(noToken.status).toBe(401);
    expect(noToken.body.code).toBe('UNAUTHORIZED');
    expect(badToken.status).toBe(401);
    expect(badToken.body.code).toBe('UNAUTHORIZED');
  });

  it('健康检查不需要鉴权，响应含 X-Request-Id', async () => {
    // when：无 token 访问健康检查
    const response = await call(ctx, { method: 'GET', url: '/api/health' });

    // then：返回 ok，且请求头带 request id
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers['x-request-id']).toMatch(/^req_/);
  });
});

describe('场景：VIP · 邮箱包含 vip', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('VIP 邮箱不区分大小写，usage 返回 unlimited', async () => {
    // given：邮箱中包含大写 VIP
    const auth = await login(ctx, 'MyVIP@Example.com', 'secret123');

    // then：用户被标记为 VIP
    expect(auth.user.isVip).toBe(true);

    const usage = await call(ctx, {
      method: 'GET',
      url: '/api/usage',
      token: auth.token,
    });
    expect(usage.status).toBe(200);
    expect(usage.body).toMatchObject({
      used: 0,
      limit: 10,
      unlimited: true,
      date: '2026-11-08',
    });
    expect(usage.body.resetsAt).toBe('2026-11-08T16:00:00.000Z');
  });
});

describe('场景：登录 · 输入校验', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('非法邮箱或过短密码返回 400 INVALID_INPUT 与字段错误', async () => {
    // when：提交非法输入
    const response = await call(ctx, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'not-an-email', password: '123' },
    });

    // then：字段错误以 details 返回
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
    expect(response.body.details.fieldErrors).toHaveProperty('email');
    expect(response.body.details.fieldErrors).toHaveProperty('password');
  });
});
