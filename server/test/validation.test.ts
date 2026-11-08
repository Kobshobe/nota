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

describe('场景：消息输入 · 校验', () => {
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

  it('20,001 字、空内容、过短 clientMessageId、多余字段都返回 400 INVALID_INPUT', async () => {
    const cases = [
      { content: 'x'.repeat(20001), clientMessageId: 'client-message-1' },
      { content: '', clientMessageId: 'client-message-1' },
      { content: '你好', clientMessageId: 'short' },
      { content: '你好', clientMessageId: 'client-message-1', extra: true },
    ];
    for (const payload of cases) {
      const response = await call(ctx, {
        method: 'POST',
        url: `/api/threads/${threadId}/messages`,
        token,
        payload,
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_INPUT');
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
    }
  });

  it('20,000 字上限内可以提交', async () => {
    ctx.faux.setResponses([finishOnly({ reply: '收到' })]);
    const response = await sendMessage(ctx, token, 'x'.repeat(20000));
    expect(response.status).toBe(200);
    expect(response.body.userMessage.content).toHaveLength(20000);
  });
});

describe('场景：错误体 · 统一形状', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('未登录访问受保护资源返回 401 UNAUTHORIZED', async () => {
    for (const [method, url] of [
      ['GET', '/api/threads'],
      ['GET', '/api/items'],
      ['GET', '/api/usage'],
    ] as const) {
      const response = await call(ctx, { method, url });
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHORIZED');
      expect(Object.keys(response.body).sort()).toEqual(['code', 'requestId', 'message'].sort());
      expect(response.body.stack).toBeUndefined();
    }
  });

  it('未知路由返回 404 NOT_FOUND，并带 X-Request-Id', async () => {
    const response = await call(ctx, { method: 'GET', url: '/api/unknown' });
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('非法 JSON 与错误 Content-Type 都映射到 INVALID_INPUT', async () => {
    const invalidJson = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(invalidJson.statusCode).toBe(400);
    expect(JSON.parse(invalidJson.body).code).toBe('INVALID_INPUT');

    const wrongType = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(wrongType.statusCode).toBe(400);
    expect(JSON.parse(wrongType.body).code).toBe('INVALID_INPUT');
  });

  it('非法列表查询参数返回 400', async () => {
    const token = (await login(ctx)).token;
    for (const query of ['limit=0', 'limit=101', 'limit=abc', 'status=deleted', 'status=nope']) {
      const response = await call(ctx, { method: 'GET', url: `/api/items?${query}`, token });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_INPUT');
    }
  });
});

describe('场景：CORS · Flutter Web', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('预检请求允许 Authorization 与 Content-Type，并暴露 X-Request-Id', async () => {
    // when：浏览器预检
    const response = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/threads',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    // then：允许来源、方法和请求头
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain('authorization');
    expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain('content-type');
    expect(String(response.headers['access-control-expose-headers']).toLowerCase()).toContain('x-request-id');
  });

  it('普通响应也带 Access-Control-Allow-Origin', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
