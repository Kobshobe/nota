import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from './db';
import { threads, users, type ThreadRow, type UserRow } from './db/schema';
import { invalidCredentials, unauthorized } from './lib/errors';
import { isVipEmail } from './quota';
import { hashPassword, verifyPassword } from './lib/password';
import { signToken } from './lib/jwt';

export const DAILY_THREAD_TITLE = '日常';

const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(6).max(128),
  })
  .strict();

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function ensureDailyThread(db: Db, userId: string, now: Date): ThreadRow {
  const existing = db
    .select()
    .from(threads)
    .where(and(eq(threads.userId, userId), eq(threads.kind, 'daily')))
    .get();
  if (existing) return existing;
  const timestamp = now.toISOString();
  const row: ThreadRow = {
    id: randomUUID(),
    userId,
    kind: 'daily',
    title: DAILY_THREAD_TITLE,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.insert(threads).values(row).run();
  return row;
}

export async function requireUser(app: FastifyInstance, request: FastifyRequest): Promise<UserRow> {
  const userId = request.user.sub;
  const user = app.db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw unauthorized();
  return user;
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/auth/login', async (request) => {
    const body = loginSchema.parse(request.body);
    const email = normalizeEmail(body.email);
    const now = app.now();
    const timestamp = now.toISOString();

    let user = app.db.select().from(users).where(eq(users.email, email)).get();
    if (!user) {
      const created: UserRow = {
        id: randomUUID(),
        email,
        passwordHash: hashPassword(body.password),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      app.db.insert(users).values(created).run();
      ensureDailyThread(app.db, created.id, now);
      user = created;
    } else {
      if (!verifyPassword(body.password, user.passwordHash)) {
        throw invalidCredentials();
      }
      ensureDailyThread(app.db, user.id, now);
    }

    return {
      token: signToken(app, user),
      user: { email: user.email, isVip: isVipEmail(user.email) },
    };
  });

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (request) => {
    const user = await requireUser(app, request);
    return { email: user.email, isVip: isVipEmail(user.email) };
  });
}
