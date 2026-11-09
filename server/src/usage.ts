import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth';
import { usageEvents } from './db/schema';
import { getUsage } from './quota';

type ChargeState = 'none' | 'reserved' | 'released';

interface ChargeCheck {
  state: ChargeState;
  message: string;
}

/**
 * 最近一条"没有计费"的账本记录，翻成一句能直接给用户看的话。
 *
 * 只看最新一条：占用中的（可能正卡着）和已释放的（扣过又退了）。
 * 只读，不写账本、不改计数。
 */
function latestAnomaly(app: FastifyInstance, userId: string): ChargeCheck {
  const event = app.db
    .select()
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), inArray(usageEvents.state, ['reserved', 'released'])))
    .orderBy(desc(usageEvents.createdAt), desc(sql`usage_events.rowid`))
    .get();

  if (!event) return { state: 'none', message: '没有发现可疑的扣费记录，最近的整理都正常计费。' };
  if (event.state === 'reserved') {
    return {
      state: 'reserved',
      message: '最近一次整理还在进行中，额度暂时占着；没跑完会自动退回。',
    };
  }
  return { state: 'released', message: '最近一次整理没有计费，额度已经退回。' };
}

export function registerUsageRoutes(app: FastifyInstance): void {
  app.get('/api/usage', { preHandler: app.authenticate }, async (request) => {
    const user = await requireUser(app, request);
    return getUsage(app.db, user, app.config, app.now());
  });

  app.get('/api/usage/last-anomaly', { preHandler: app.authenticate }, async (request) => {
    const user = await requireUser(app, request);
    return latestAnomaly(app, user.id);
  });
}
