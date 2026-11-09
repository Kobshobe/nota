#!/usr/bin/env node
/**
 * 额度对账。
 *
 * 回答一个问题：扣掉的次数，是不是每一次都能在账本和业务数据里找到对应。
 *
 * 等式（按用户、按额度日界切分）：
 *
 *   1. `usage_daily.used` = 账本上线前的 assistant 消息数 + 账本里未释放的行数
 *      账本上线前每一轮成功的运行都计费，所以那个时期的 assistant 消息数就是扣费数。
 *   1b. 被释放的占用不应当有 assistant 产出；有就说明这次少收了。
 *   2. 每一条 `committed` 事件，`ref_id` 指向的用户消息必须有 assistant 回复。
 *   3. 账本上线后写入的每一条 assistant 消息，它所属的用户消息必须有账本行。
 *
 * 计数器和账本在同一事务里写，所以两者永远一致；只靠它能查出的只有"账记错了"。
 * "收没收够"要拿业务数据当第二个源：一次成功的运行恰好产出一条 assistant 消息。
 *
 * 用法：`make reconcile`，或 `node server/scripts/reconcile-usage.mjs`
 * 有差异时退出码为 1。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readEnvFile(filePath) {
  try {
    const text = readFileSync(filePath, 'utf8');
    const out = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index === -1) continue;
      out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
    }
    return out;
  } catch {
    return {};
  }
}

const env = { ...readEnvFile(path.join(repoRoot, '.env')), ...process.env };
const timeZone = env.QUOTA_TIMEZONE?.trim() || 'Asia/Shanghai';
const databasePath = path.resolve(repoRoot, env.DATABASE_PATH?.trim() || './data/nota.db');

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dayOf = (iso) => dayFormatter.format(new Date(iso));

const db = new Database(databasePath, { readonly: true, fileMustExist: true });

const cutover = db.prepare('select min(created_at) as at from usage_events').get()?.at ?? null;

const counters = db.prepare('select user_id, day, used from usage_daily').all();
const events = db
  .prepare(
    'select user_id, day, state, release_reason, ref_id, idempotency_key, created_at from usage_events',
  )
  .all();
const assistants = db
  .prepare(
    `select m.id as id, m.created_at as created_at, m.user_message_id as userMessageId,
            t.user_id as userId
       from messages m
       join threads t on t.id = m.thread_id
      where m.role = 'assistant'`,
  )
  .all();

const bucket = (userId, day) => {
  const key = `${userId}|${day}`;
  if (!buckets.has(key)) {
    buckets.set(key, {
      userId,
      day,
      counter: 0,
      legacy: 0,
      ledger: 0,
      released: [],
      problems: [],
    });
  }
  return buckets.get(key);
};
const buckets = new Map();

for (const row of counters) bucket(row.user_id, row.day).counter = row.used;

const committedRefs = new Set();
for (const row of events) {
  const entry = bucket(row.user_id, row.day);
  if (row.state === 'released') {
    entry.released.push(row);
    continue;
  }
  entry.ledger += 1;
  if (row.state === 'committed' && row.ref_id) committedRefs.add(row.ref_id);
}

const assistantByUserMessage = new Set(
  assistants.filter((row) => row.userMessageId).map((row) => row.userMessageId),
);

for (const row of assistants) {
  const day = dayOf(row.created_at);
  // 账本上线前每一轮成功的运行都计费，用 assistant 条数回推那一段的扣费数。
  if (cutover && row.created_at < cutover) bucket(row.userId, day).legacy += 1;
}

// 1) committed 必须有产出。
for (const row of events) {
  if (row.state !== 'committed' || !row.ref_id) continue;
  if (assistantByUserMessage.has(row.ref_id)) continue;
  bucket(row.user_id, row.day).problems.push(
    `扣了费但没有产出：ref=${row.ref_id} key=${row.idempotency_key}`,
  );
}

// 2) 账本上线后写出的 assistant 必须有账本行。
if (cutover) {
  for (const row of assistants) {
    if (row.created_at < cutover || !row.userMessageId) continue;
    if (committedRefs.has(row.userMessageId)) continue;
    const day = dayOf(row.created_at);
    const entry = bucket(row.userId, day);
    // 无产出运行的 assistant 也在里面，只要那天账本上出现过这个 ref 就算有账。
    const known = events.some(
      (event) => event.ref_id === row.userMessageId && event.user_id === row.userId,
    );
    if (known) continue;
    entry.problems.push(`有产出但没有账本行：assistant=${row.id}`);
  }
}

// 3) 被超时释放、但后来还是产出了结果：这次少收了一次。
//    这是 TTL 太短造成的，账本与计数器依然一致，只能靠比对业务数据发现。
const retired = events.filter((row) => row.release_reason === 'no_output').length;
const releasedRefs = new Map();
for (const row of events) {
  if (row.state === 'released' && row.ref_id) {
    releasedRefs.set(`${row.user_id}|${row.ref_id}`, row.release_reason ?? 'unknown');
  }
}
for (const row of assistants) {
  if (!row.userMessageId) continue;
  const reason = releasedRefs.get(`${row.userId}|${row.userMessageId}`);
  // no_output 是旧规则（无产出不计费）留下的，那套规则已经不存在，不参与判定。
  if (reason !== 'stale') continue;
  bucket(row.userId, dayOf(row.created_at)).problems.push(
    `少收一次：占用被 ${reason} 释放，但结果已经产出（assistant=${row.id}）`,
  );
}

// 账本上线前的日子没有任何账本行，当时的行为无法重建，不纳入比对。
const all = [...buckets.values()];
const legacyDays = all.filter((entry) => entry.ledger === 0 && entry.released.length === 0);
const comparable = all.filter((entry) => !legacyDays.includes(entry));
const mismatches = comparable.filter(
  (entry) => entry.problems.length > 0 || entry.counter !== entry.legacy + entry.ledger,
);

const legacyNote =
  (legacyDays.length > 0 ? `；另有 ${legacyDays.length} 个组合早于账本，已跳过` : '') +
  (retired > 0 ? `；${retired} 行是旧规则留下的 no_output，已忽略` : '');

if (mismatches.length === 0) {
  const total = comparable.reduce((sum, entry) => sum + entry.released.length, 0);
  console.log(
    `对账通过：${comparable.length} 个用户-日期组合一致（时区 ${timeZone}），账本记录了 ${total} 次未计费${legacyNote}。`,
  );
  db.close();
  process.exit(0);
}

console.log(
  `对账发现差异：${mismatches.length} 个用户-日期组合（时区 ${timeZone}）${legacyNote}`,
);
for (const entry of mismatches.sort((a, b) => (a.day < b.day ? -1 : 1))) {
  console.log(
    `\n${entry.day}  user=${entry.userId}\n` +
      `  used=${entry.counter}  期望=${entry.legacy + entry.ledger}（上线前 ${entry.legacy} + 账本 ${entry.ledger}）`,
  );
  for (const problem of entry.problems) console.log(`  ${problem}`);
  for (const row of entry.released) {
    console.log(
      `  未计费 ${row.release_reason ?? 'unknown'}  ref=${row.ref_id ?? '-'}  ${row.created_at}`,
    );
  }
}
console.log(
  '\n读法：used 比期望高说明有扣费没落地；低说明退多了；"少收一次"说明占用被释放但结果仍产出，通常是 TTL 太短。',
);
db.close();
process.exit(1);
