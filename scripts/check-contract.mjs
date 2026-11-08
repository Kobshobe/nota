#!/usr/bin/env node
// 运行时契约一致性：起服务，按真实用户路径打请求，逐条核对状态码、字段和错误码。
// 覆盖认证、threads、items、usage；消息/工具轨迹/候选来源/429 由 server/test/contract-message.test.ts 覆盖。
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:8080';
const startCommand = process.env.START_CMD ?? 'npm --prefix server run start';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isHealthy() {
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

let child = null;

function stopChild() {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill();
  }
}
if (!(await isHealthy())) {
  child = spawn('sh', ['-c', startCommand], { cwd: root, stdio: 'ignore', detached: true });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await isHealthy()) break;
    await sleep(150);
  }
  if (!(await isHealthy())) {
    console.error(`服务没有在 ${base} 上起来。检查 START_CMD（当前：${startCommand}）。`);
    stopChild();
    process.exit(1);
  }
  console.log(`（未发现运行中的服务，已临时启动：${base}）`);
}

const contract = yaml.load(await readFile(path.join(root, 'contract/openapi.yaml'), 'utf8'));
const allowedCodes = contract.components?.schemas?.ErrorResponse?.properties?.code?.enum ?? [];
const results = [];
let token = '';
let threadId = '';
let itemId = '';

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
}

const keySet = (object) => Object.keys(object ?? {}).sort().join(',');

async function send(spec) {
  const headers = { ...(spec.headers ?? {}) };
  if (spec.auth) headers.authorization = `Bearer ${token}`;
  if (spec.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${spec.path}`, {
    method: spec.method,
    headers,
    body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
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

function expectSuccess(label, response, expected) {
  check(
    `${label}：状态码 ${expected.status}`,
    response.response.status === expected.status,
    `实际 ${response.response.status} ${response.text.slice(0, 160)}`,
  );
  check(`${label}：返回 JSON`, Boolean(response.json), response.text.slice(0, 120));
  if (expected.keys) {
    check(
      `${label}：字段集合`,
      keySet(response.json) === [...expected.keys].sort().join(','),
      `实际 ${keySet(response.json)}`,
    );
  }
  check(`${label}：有 X-Request-Id`, Boolean(response.response.headers.get('x-request-id')));
}

function expectError(label, response, expected) {
  check(`${label}：状态码 ${expected.status}`, response.response.status === expected.status, `实际 ${response.response.status}`);
  check(`${label}：错误体`, Boolean(response.json?.code && response.json?.message && response.json?.requestId), response.text.slice(0, 160));
  check(`${label}：错误码 ${expected.code}`, response.json?.code === expected.code, response.json?.code);
  check(`${label}：错误码在契约枚举内`, allowedCodes.includes(response.json?.code), response.json?.code);
}

async function main() {
  const stamp = Date.now();
  const email = `contract-${stamp}@example.com`;
  const password = 'nota-contract-123';

  check('契约可解析', Boolean(contract?.openapi), contract?.openapi ?? '读不到 openapi 字段');
  check(
    'Message 契约含 toolCalls',
    Boolean(contract?.components?.schemas?.Message?.properties?.toolCalls),
  );
  check(
    'Item 契约含候选来源字段',
    Boolean(
      contract?.components?.schemas?.Item?.properties?.sourceMessageId &&
        contract?.components?.schemas?.Item?.properties?.candidateIndex,
    ),
  );

  const health = await send({ method: 'GET', path: '/api/health' });
  expectSuccess('健康检查', health, { status: 200, keys: ['ok'] });
  check('健康检查：ok 为 true', health.json?.ok === true);

  const login = await send({ method: 'POST', path: '/api/auth/login', body: { email, password } });
  expectSuccess('登录 / 自动注册', login, { status: 200, keys: ['token', 'user'] });
  check('登录：返回 JWT', typeof login.json?.token === 'string' && login.json.token.length > 20);
  check('登录：用户字段', keySet(login.json?.user) === 'email,isVip', keySet(login.json?.user));
  token = login.json?.token ?? '';

  const me = await send({ method: 'GET', path: '/api/auth/me', auth: true });
  expectSuccess('当前用户', me, { status: 200, keys: ['email', 'isVip'] });
  check('当前用户：邮箱一致', me.json?.email === email);

  const threads = await send({ method: 'GET', path: '/api/threads', auth: true });
  expectSuccess('对话列表', threads, { status: 200, keys: ['threads'] });
  check('对话列表：含日常 thread', Array.isArray(threads.json?.threads) && threads.json.threads.some((t) => t.kind === 'daily'));

  const createdThread = await send({
    method: 'POST',
    path: '/api/threads',
    auth: true,
    body: { kind: 'meeting', title: '契约检查会议' },
  });
  expectSuccess('新建会议', createdThread, { status: 201, keys: ['id', 'kind', 'title', 'createdAt', 'updatedAt'] });
  threadId = createdThread.json?.id ?? '';
  check('新建会议：kind 为 meeting', createdThread.json?.kind === 'meeting');

  const thread = await send({ method: 'GET', path: `/api/threads/${threadId}`, auth: true });
  expectSuccess('对话详情', thread, { status: 200, keys: ['thread', 'messages'] });

  const items = await send({ method: 'GET', path: '/api/items', auth: true });
  expectSuccess('事项列表', items, { status: 200, keys: ['items'] });

  const createdItem = await send({
    method: 'POST',
    path: '/api/items',
    auth: true,
    body: { threadId, kind: 'todo', title: '契约检查事项' },
  });
  expectSuccess('按钮直建事项', createdItem, {
    status: 201,
    keys: ['id', 'threadId', 'kind', 'title', 'status', 'createdAt', 'updatedAt'],
  });
  itemId = createdItem.json?.id ?? '';
  check('按钮直建事项：status 为 open', createdItem.json?.status === 'open');

  const patched = await send({
    method: 'PATCH',
    path: `/api/items/${itemId}`,
    auth: true,
    body: { title: '契约检查事项（改）' },
  });
  expectSuccess('修改事项', patched, {
    status: 200,
    keys: ['id', 'threadId', 'kind', 'title', 'status', 'createdAt', 'updatedAt'],
  });
  check('修改事项：标题生效', patched.json?.title === '契约检查事项（改）');

  const completed = await send({ method: 'POST', path: `/api/items/${itemId}/complete`, auth: true });
  expectSuccess('完成事项', completed, {
    status: 200,
    keys: ['id', 'threadId', 'kind', 'title', 'status', 'createdAt', 'updatedAt'],
  });
  check('完成事项：status 为 done', completed.json?.status === 'done');

  const deleted = await send({ method: 'DELETE', path: `/api/items/${itemId}`, auth: true });
  check('删除事项：状态码 204', deleted.response.status === 204, `实际 ${deleted.response.status}`);
  check('删除事项：空响应', deleted.text === '');

  const timedTodo = await send({
    method: 'POST',
    path: '/api/items',
    auth: true,
    body: {
      threadId,
      kind: 'todo',
      title: '契约检查待办',
      dueAt: '2026-11-09T09:00:00+08:00',
    },
  });
  expectSuccess('带时间的按钮直建待办', timedTodo, {
    status: 201,
    keys: ['dueAt', 'id', 'threadId', 'kind', 'title', 'status', 'createdAt', 'updatedAt'],
  });
  const cleared = await send({
    method: 'PATCH',
    path: `/api/items/${timedTodo.json.id}`,
    auth: true,
    body: { dueAt: null },
  });
  expectSuccess('清空待办时间', cleared, {
    status: 200,
    keys: ['id', 'threadId', 'kind', 'title', 'status', 'createdAt', 'updatedAt'],
  });
  check('清空待办时间：dueAt 已移除', !('dueAt' in (cleared.json ?? {})));
  const stored = await send({
    method: 'GET',
    path: `/api/items?threadId=${threadId}`,
    auth: true,
  });
  const storedItem = stored.json?.items?.find((item) => item.id === timedTodo.json.id);
  check('清空待办时间：已持久化', storedItem && !('dueAt' in storedItem));

  const reminder = await send({
    method: 'POST',
    path: '/api/items',
    auth: true,
    body: {
      threadId,
      kind: 'reminder',
      title: '契约检查提醒',
      dueAt: '2026-11-09T09:00:00+08:00',
    },
  });
  expectSuccess('按钮直建提醒', reminder, {
    status: 201,
    keys: ['dueAt', 'id', 'threadId', 'kind', 'title', 'status', 'createdAt', 'updatedAt'],
  });
  const rejectedClear = await send({
    method: 'PATCH',
    path: `/api/items/${reminder.json.id}`,
    auth: true,
    body: { dueAt: null },
  });
  expectError('提醒不能清空时间', rejectedClear, { status: 400, code: 'INVALID_INPUT' });
  await send({ method: 'DELETE', path: `/api/items/${timedTodo.json.id}`, auth: true });
  await send({ method: 'DELETE', path: `/api/items/${reminder.json.id}`, auth: true });

  const usage = await send({ method: 'GET', path: '/api/usage', auth: true });
  expectSuccess('额度', usage, { status: 200, keys: ['used', 'limit', 'unlimited', 'date', 'resetsAt'] });
  check('额度：Free 未超额', usage.json?.used === 0 && usage.json?.unlimited === false);

  const badLogin = await send({ method: 'POST', path: '/api/auth/login', body: { email, password: 'wrong-password' } });
  expectError('错误密码', badLogin, { status: 401, code: 'INVALID_CREDENTIALS' });

  const badInput = await send({ method: 'POST', path: '/api/auth/login', body: { email: 'not-an-email', password: 'x' } });
  expectError('非法输入', badInput, { status: 400, code: 'INVALID_INPUT' });

  const reminderWithoutDue = await send({
    method: 'POST',
    path: '/api/items',
    auth: true,
    body: { threadId, kind: 'reminder', title: '没有时间的提醒' },
  });
  expectError('提醒缺时间', reminderWithoutDue, { status: 400, code: 'INVALID_INPUT' });

  const notFound = await send({ method: 'GET', path: '/api/threads/does-not-exist', auth: true });
  expectError('不存在的 thread', notFound, { status: 404, code: 'NOT_FOUND' });

  const unauthorized = await send({ method: 'GET', path: '/api/threads' });
  expectError('未登录', unauthorized, { status: 401, code: 'UNAUTHORIZED' });

  const vipEmail = `vip-${stamp}@example.com`;
  const vipLogin = await send({ method: 'POST', path: '/api/auth/login', body: { email: vipEmail, password } });
  check('VIP 登录：状态码 200', vipLogin.response.status === 200);
  token = vipLogin.json?.token ?? '';
  const vipUsage = await send({ method: 'GET', path: '/api/usage', auth: true });
  expectSuccess('VIP 额度', vipUsage, { status: 200, keys: ['used', 'limit', 'unlimited', 'date', 'resetsAt'] });
  check('VIP 额度：unlimited 为 true', vipUsage.json?.unlimited === true);
}

try {
  await main();
} finally {
  let failed = 0;
  for (const result of results) {
    if (result.ok) {
      console.log(`  PASS  ${result.name}`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
    }
  }
  console.log(`\n共 ${results.length} 项，失败 ${failed} 项。`);
  if (failed > 0) process.exitCode = 1;
  stopChild();
}
