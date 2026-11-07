#!/usr/bin/env node
// 运行时契约一致性：起服务，按下面声明的 cases 打真实请求，逐条核对响应。
// 这是「第三层防线」——单测各自绿，不能证明两端对得上。
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

// ───────────── 改这里：声明要在运行时验证的行为 ─────────────
// expect.keys 是响应顶层字段的完整集合（顺序无关，多一个少一个都算错）。
const cases = [
  {
    name: '健康检查',
    method: 'GET',
    path: '/api/health',
    expect: { status: 200, keys: ['ok'] },
  },
  // {
  //   name: '写一条业务用例',
  //   method: 'POST',
  //   path: '/api/你的端点',
  //   body: { 字段: '值' },
  //   expect: { status: 200, keys: ['返回字段一', '返回字段二'] },
  // },
];
// ────────────────────────────────────────────────────────────

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
if (!(await isHealthy())) {
  child = spawn('sh', ['-c', startCommand], { cwd: root, stdio: 'ignore' });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isHealthy()) break;
    await sleep(100);
  }
  if (!(await isHealthy())) {
    console.error(`服务没有在 ${base} 上起来。检查 START_CMD（当前：${startCommand}）。`);
    child?.kill();
    process.exit(1);
  }
  console.log(`（未发现运行中的服务，已临时启动：${base}）`);
}

const contract = yaml.load(await readFile(path.join(root, 'contract/openapi.yaml'), 'utf8'));
const allowedCodes = contract.components?.schemas?.ErrorResponse?.properties?.code?.enum ?? [];
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
}

const keySet = (object) => Object.keys(object ?? {}).sort().join(',');

async function send(spec) {
  const init = { method: spec.method, headers: {} };
  if (spec.body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(spec.body);
  }
  const response = await fetch(`${base}${spec.path}`, init);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, contentType: response.headers.get('content-type') ?? '', json, text };
}

check('契约可解析', Boolean(contract?.openapi), contract?.openapi ?? '读不到 openapi 字段');

for (const spec of cases) {
  const response = await send(spec);
  const label = spec.name ?? `${spec.method} ${spec.path}`;

  check(`${label}：状态码 ${spec.expect.status}`, response.status === spec.expect.status, `实际 ${response.status} ${response.text.slice(0, 120)}`);
  check(`${label}：返回 JSON`, response.contentType.includes('application/json'), response.contentType);
  if (spec.expect.keys) {
    check(`${label}：字段集合`, keySet(response.json) === [...spec.expect.keys].sort().join(','), `实际 ${keySet(response.json)}`);
  }
  if (response.json?.code && allowedCodes.length > 0) {
    check(`${label}：错误码在契约枚举内`, allowedCodes.includes(response.json.code), response.json.code);
  }
}

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

child?.kill();
