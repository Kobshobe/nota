#!/usr/bin/env node
// 端到端冒烟：真实 HTTP 路径。默认不调模型；设 E2E_MESSAGE=1 时再走一次真实 Agent 消息。
const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:8080';
const stamp = Date.now();
const email = `e2e-${stamp}@example.com`;
const password = 'nota-e2e-123';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, json, text };
}

console.log(`E2E ${base}`);
const health = await call('GET', '/api/health');
assert(health.response.ok && health.json?.ok === true, '健康检查失败');

const login = await call('POST', '/api/auth/login', { body: { email, password } });
assert(login.response.status === 200 && login.json?.token, `登录失败：${login.response.status} ${login.text}`);
const token = login.json.token;

const me = await call('GET', '/api/auth/me', { token });
assert(me.response.status === 200 && me.json?.email === email, '当前用户不正确');

const threads = await call('GET', '/api/threads', { token });
assert(threads.response.status === 200 && threads.json.threads.some((t) => t.kind === 'daily'), '缺少日常 thread');

const thread = await call('POST', '/api/threads', { token, body: { kind: 'meeting', title: 'E2E 会议' } });
assert(thread.response.status === 201 && thread.json?.id, `新建会议失败：${thread.text}`);

const item = await call('POST', '/api/items', {
  token,
  body: { threadId: thread.json.id, kind: 'todo', title: 'E2E 事项' },
});
assert(item.response.status === 201 && item.json?.id, `直建事项失败：${item.text}`);

const done = await call('POST', `/api/items/${item.json.id}/complete`, { token });
assert(done.response.status === 200 && done.json?.status === 'done', '完成事项失败');

const list = await call('GET', '/api/items?status=done', { token });
assert(list.response.status === 200 && list.json.items.some((i) => i.id === item.json.id), '事项列表缺少已完成事项');

const usage = await call('GET', '/api/usage', { token });
assert(usage.response.status === 200 && usage.json?.used === 0, '按钮操作不应扣额度');

if (process.env.E2E_MESSAGE === '1') {
  const message = await call('POST', `/api/threads/${thread.json.id}/messages`, {
    token,
    body: {
      content: '提醒我两个小时后去游泳',
      clientMessageId: `e2e-${stamp}-message`,
    },
  });
  assert(message.response.status === 200, `发消息失败：${message.response.status} ${message.text}`);
  const payload = message.json?.assistantMessage?.payload;
  assert(payload?.summary || payload?.reply, '消息缺少 summary / reply');
  assert(Array.isArray(message.json?.toolCalls) && message.json.toolCalls.length > 0, '消息缺少工具轨迹');
  assert(message.json?.usage?.used === 1, '一次消息应扣 1 次额度');
  console.log('  真实 Agent 消息：通过');
}

console.log('E2E 通过');
