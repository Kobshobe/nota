import { randomUUID } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import { usageDaily, usageEvents, type UsageEventRow } from './db/schema';
import type { Db } from './db';
import type { AppConfig } from './config';
import { quotaExceeded } from './lib/errors';
import { dayInTimeZone, nextResetAt, secondsUntil } from './lib/time';

export interface UsageDto {
  used: number;
  limit: number;
  unlimited: boolean;
  date: string;
  resetsAt: string;
}

export type UsageReason = 'message' | 'recording';
export type ReleaseReason = 'failed' | 'stale';

export interface ReserveInput {
  idempotencyKey: string;
  reason: UsageReason;
  refId?: string;
}

export interface Reservation {
  event: UsageEventRow;
  /** 账本行是不是这次调用新建的。false 表示命中已有行，没有新建也没有重复计数。 */
  created: boolean;
}

export function isVipEmail(email: string): boolean {
  return email.toLowerCase().includes('vip');
}

export function getUsage(
  db: Db,
  user: { id: string; email: string },
  config: AppConfig,
  now: Date,
): UsageDto {
  const day = dayInTimeZone(now, config.quotaTimezone);
  const row = db
    .select()
    .from(usageDaily)
    .where(and(eq(usageDaily.userId, user.id), eq(usageDaily.day, day)))
    .get();
  return {
    used: row?.used ?? 0,
    limit: config.dailyLimit,
    unlimited: isVipEmail(user.email),
    date: day,
    resetsAt: nextResetAt(now, config.quotaTimezone).toISOString(),
  };
}

/**
 * 占用一次额度并写下账本行。
 *
 * 账本行插入与计数自增在同一个事务里：额度不足时整笔回滚，不会留下孤儿账本行。
 * 幂等键命中已有行时返回那一行，交给调用方判断是否可以复用首次结果。
 *
 * 已有行的三种状态：
 * - `committed`：首次运行已成功，`created` 为 false，调用方应直接返回首次结果。
 * - `released`：上一次尝试失败或无产出，重新占用；跨天时退掉原日的计数。
 * - `reserved`：另一次尝试仍在跑。同日不重复计数，调用方可以继续执行，计费只会落一次。
 */
export function reserveQuota(
  db: Db,
  user: { id: string; email: string },
  config: AppConfig,
  now: Date,
  input: ReserveInput,
): Reservation {
  const day = dayInTimeZone(now, config.quotaTimezone);
  const unlimited = isVipEmail(user.email);
  const timestamp = now.toISOString();

  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(usageEvents)
      .where(
        and(eq(usageEvents.userId, user.id), eq(usageEvents.idempotencyKey, input.idempotencyKey)),
      )
      .get();

    if (existing && existing.state === 'committed') {
      return { event: existing, created: false };
    }

    if (existing && existing.state === 'reserved' && existing.day === day) {
      return { event: existing, created: false };
    }

    // `released`，或 `reserved` 但记在别的日子上：重新占用。
    if (existing) {
      if (existing.day !== day) refundDay(tx, user.id, existing.day, timestamp);
      incrementDay(tx, user.id, day, config, unlimited, now);
      const updated: UsageEventRow = {
        ...existing,
        day,
        state: 'reserved',
        releaseReason: null,
        refId: input.refId ?? existing.refId,
        updatedAt: timestamp,
      };
      tx.update(usageEvents)
        .set({
          day: updated.day,
          state: updated.state,
          releaseReason: null,
          refId: updated.refId,
          updatedAt: updated.updatedAt,
        })
        .where(eq(usageEvents.id, existing.id))
        .run();
      return { event: updated, created: true };
    }

    const event: UsageEventRow = {
      id: randomUUID(),
      userId: user.id,
      day,
      idempotencyKey: input.idempotencyKey,
      state: 'reserved',
      reason: input.reason,
      releaseReason: null,
      refId: input.refId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    tx.insert(usageEvents).values(event).run();
    incrementDay(tx, user.id, day, config, unlimited, now);
    return { event, created: true };
  });
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * 计数自增。限定次数时把 `used < limit` 放进 WHERE，判定与自增是一条语句。
 * 超额时抛 429，外层事务回滚，账本行一并消失。
 */
function incrementDay(
  tx: Tx,
  userId: string,
  day: string,
  config: AppConfig,
  unlimited: boolean,
  now: Date,
): void {
  const updatedAt = now.toISOString();
  const limit = config.dailyLimit;
  const guard = unlimited
    ? and(eq(usageDaily.userId, userId), eq(usageDaily.day, day))
    : and(eq(usageDaily.userId, userId), eq(usageDaily.day, day), lt(usageDaily.used, limit));

  const changed = tx
    .update(usageDaily)
    .set({ used: sql`${usageDaily.used} + 1`, updatedAt })
    .where(guard)
    .run().changes;

  if (changed > 0) return;

  const row = tx
    .select()
    .from(usageDaily)
    .where(and(eq(usageDaily.userId, userId), eq(usageDaily.day, day)))
    .get();
  if (row) throw exceeded(config, now, day, row.used);

  // 当天还没有行：第一次消耗。并发下由唯一索引兜住，冲突说明别人先插了，按超额判定。
  try {
    tx.insert(usageDaily).values({ userId, day, used: 1, updatedAt }).run();
  } catch {
    throw exceeded(config, now, day, limit);
  }
}

function exceeded(config: AppConfig, now: Date, day: string, used: number): never {
  const resetsAt = nextResetAt(now, config.quotaTimezone);
  throw quotaExceeded('Daily quota exhausted', secondsUntil(resetsAt, now), {
    date: day,
    used,
    limit: config.dailyLimit,
    resetsAt: resetsAt.toISOString(),
  });
}

function refundDay(tx: Tx, userId: string, day: string, timestamp: string): void {
  tx.update(usageDaily)
    .set({ used: sql`max(${usageDaily.used} - 1, 0)`, updatedAt: timestamp })
    .where(and(eq(usageDaily.userId, userId), eq(usageDaily.day, day)))
    .run();
}

/**
 * 结账：本轮跑成功了，占用转为 `committed`。
 * 账本行已被清扫释放时不再动计数，静默返回 `false`。
 */
export function settleQuota(tx: Tx, eventId: string, now: Date): boolean {
  const event = tx.select().from(usageEvents).where(eq(usageEvents.id, eventId)).get();
  if (!event || event.state !== 'reserved') return false;

  tx.update(usageEvents)
    .set({ state: 'committed', releaseReason: null, updatedAt: now.toISOString() })
    .where(eq(usageEvents.id, eventId))
    .run();
  return true;
}

/** 失败释放。账本行已不是 `reserved` 时什么也不做，计数不会退两次。 */
export function releaseQuota(db: Db, eventId: string, reason: ReleaseReason, now: Date): boolean {
  return db.transaction((tx) => {
    const event = tx.select().from(usageEvents).where(eq(usageEvents.id, eventId)).get();
    if (!event || event.state !== 'reserved') return false;
    tx.update(usageEvents)
      .set({ state: 'released', releaseReason: reason, updatedAt: now.toISOString() })
      .where(eq(usageEvents.id, eventId))
      .run();
    refundDay(tx, event.userId, event.day, now.toISOString());
    return true;
  });
}

/**
 * 回收超期未结账的占用。进程崩在运行中途时只有这条路径能把额度退回去。
 * 返回被释放的行数。
 */
export function reapExpiredReservations(db: Db, now: Date, ttlMinutes: number): number {
  const cutoff = new Date(now.getTime() - ttlMinutes * 60_000).toISOString();
  const stale = db
    .select({ id: usageEvents.id })
    .from(usageEvents)
    .where(and(eq(usageEvents.state, 'reserved'), lt(usageEvents.updatedAt, cutoff)))
    .all();

  let released = 0;
  for (const row of stale) {
    if (releaseQuota(db, row.id, 'stale', now)) released += 1;
  }
  return released;
}
