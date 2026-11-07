import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './db';
import { usageDaily } from './db/schema';
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

export function chargeQuota(
  db: Db,
  user: { id: string; email: string },
  config: AppConfig,
  now: Date,
): { day: string } {
  const day = dayInTimeZone(now, config.quotaTimezone);
  const unlimited = isVipEmail(user.email);
  const updatedAt = now.toISOString();

  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(usageDaily)
      .where(and(eq(usageDaily.userId, user.id), eq(usageDaily.day, day)))
      .get();
    const used = row?.used ?? 0;
    if (!unlimited && used >= config.dailyLimit) {
      const resetsAt = nextResetAt(now, config.quotaTimezone);
      throw quotaExceeded('Daily quota exhausted', secondsUntil(resetsAt, now), {
        date: day,
        used,
        limit: config.dailyLimit,
        resetsAt: resetsAt.toISOString(),
      });
    }
    if (row) {
      tx.update(usageDaily)
        .set({ used: used + 1, updatedAt })
        .where(and(eq(usageDaily.userId, user.id), eq(usageDaily.day, day)))
        .run();
    } else {
      tx.insert(usageDaily).values({ userId: user.id, day, used: 1, updatedAt }).run();
    }
    return { day };
  });
}

export function refundQuota(db: Db, userId: string, day: string, now: Date): void {
  db.update(usageDaily)
    .set({ used: sql`max(${usageDaily.used} - 1, 0)`, updatedAt: now.toISOString() })
    .where(and(eq(usageDaily.userId, userId), eq(usageDaily.day, day)))
    .run();
}
