import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth';
import { messages, threads, type ThreadRow } from './db/schema';
import { notFound } from './lib/errors';
import { toMessageDto, toThreadDto } from './lib/dto';

export const DEFAULT_MEETING_TITLE = '新会议';

const createThreadSchema = z
  .object({
    kind: z.literal('meeting'),
    title: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export function getOwnedThread(
  app: FastifyInstance,
  userId: string,
  threadId: string,
): ThreadRow {
  const thread = app.db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
    .get();
  if (!thread) throw notFound('Thread not found');
  return thread;
}

export function registerThreadRoutes(app: FastifyInstance): void {
  app.get('/api/threads', { preHandler: app.authenticate }, async (request) => {
    const user = await requireUser(app, request);
    const rows = app.db
      .select()
      .from(threads)
      .where(eq(threads.userId, user.id))
      .orderBy(desc(threads.updatedAt), desc(threads.createdAt), desc(sql`threads.rowid`))
      .all();
    return { threads: rows.map(toThreadDto) };
  });

  app.post('/api/threads', { preHandler: app.authenticate }, async (request, reply) => {
    const user = await requireUser(app, request);
    const body = createThreadSchema.parse(request.body);
    const now = app.now().toISOString();
    const row: ThreadRow = {
      id: randomUUID(),
      userId: user.id,
      kind: 'meeting',
      title: body.title ?? DEFAULT_MEETING_TITLE,
      createdAt: now,
      updatedAt: now,
    };
    app.db.insert(threads).values(row).run();
    return reply.code(201).send(toThreadDto(row));
  });

  app.get('/api/threads/:threadId', { preHandler: app.authenticate }, async (request) => {
    const user = await requireUser(app, request);
    const { threadId } = request.params as { threadId: string };
    const thread = getOwnedThread(app, user.id, threadId);
    const rows = app.db
      .select()
      .from(messages)
      .where(eq(messages.threadId, thread.id))
      .orderBy(sql`${messages.createdAt} asc, messages.rowid asc`)
      .all();
    return { thread: toThreadDto(thread), messages: rows.map(toMessageDto) };
  });
}
