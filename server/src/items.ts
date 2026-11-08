import { randomUUID } from 'node:crypto';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth';
import { threads, items, messages, type ItemRow } from './db/schema';
import { invalidInput, notFound } from './lib/errors';
import { parsePayload, toItemDto } from './lib/dto';
import { getOwnedThread } from './threads';

const dateTime = z.string().datetime({ offset: true, message: 'Must be an ISO 8601 date-time' });

const createItemSchema = z
  .object({
    threadId: z.string().min(1),
    kind: z.enum(['reminder', 'todo']),
    title: z.string().min(1).max(200),
    dueAt: dateTime.optional(),
    scheduledAt: dateTime.optional(),
    sourceMessageId: z.string().min(1).optional(),
    candidateIndex: z.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.sourceMessageId === undefined) === (value.candidateIndex === undefined),
    { message: 'sourceMessageId and candidateIndex must be provided together' },
  );

const updateItemSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    dueAt: dateTime.nullable().optional(),
    scheduledAt: dateTime.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.dueAt !== undefined ||
      value.scheduledAt !== undefined,
    { message: 'At least one field is required' },
  );

const listItemsQuerySchema = z.object({
  status: z.enum(['open', 'done']).optional(),
  threadId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export function normalizeDueAt(dueAt: string): string {
  return new Date(dueAt).toISOString();
}

export function registerItemRoutes(app: FastifyInstance): void {
  app.get('/api/items', { preHandler: app.authenticate }, async (request) => {
    const user = await requireUser(app, request);
    const query = listItemsQuerySchema.parse(request.query);
    const conditions = [eq(items.userId, user.id)];
    conditions.push(query.status ? eq(items.status, query.status) : ne(items.status, 'deleted'));
    if (query.threadId) conditions.push(eq(items.threadId, query.threadId));

    const rows = app.db
      .select()
      .from(items)
      .where(and(...conditions))
      .orderBy(desc(items.updatedAt), desc(items.createdAt), desc(sql`items.rowid`))
      .limit(query.limit)
      .all();
    return { items: rows.map(toItemDto) };
  });

  app.post('/api/items', { preHandler: app.authenticate }, async (request, reply) => {
    const user = await requireUser(app, request);
    const body = createItemSchema.parse(request.body);
    if (body.kind === 'reminder' && !body.dueAt) {
      throw invalidInput('A reminder requires dueAt', { dueAt: 'Required for reminders' });
    }
    const thread = getOwnedThread(app, user.id, body.threadId);
    if (body.sourceMessageId !== undefined && body.candidateIndex !== undefined) {
      const source = app.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.id, body.sourceMessageId),
            eq(messages.threadId, thread.id),
            eq(messages.role, 'assistant'),
          ),
        )
        .get();
      if (!source) {
        throw invalidInput('sourceMessageId must be an assistant message in this thread');
      }
      const actions = parsePayload(source.payloadJson)?.actions ?? [];
      const candidate = actions[body.candidateIndex];
      if (!candidate) {
        throw invalidInput('candidateIndex does not point to a candidate action', {
          candidateIndex: body.candidateIndex,
        });
      }
      if (candidate.title.trim() !== body.title.trim()) {
        throw invalidInput('title does not match the candidate action', {
          expectedTitle: candidate.title,
        });
      }
    }
    const now = app.now();
    const timestamp = now.toISOString();
    const row: ItemRow = {
      id: randomUUID(),
      userId: user.id,
      threadId: thread.id,
      kind: body.kind,
      title: body.title,
      dueAt: body.dueAt ? normalizeDueAt(body.dueAt) : null,
      scheduledAt: body.scheduledAt ? normalizeDueAt(body.scheduledAt) : null,
      sourceMessageId: body.sourceMessageId ?? null,
      candidateIndex: body.candidateIndex ?? null,
      status: 'open',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      app.db.transaction((tx) => {
        tx.insert(items).values(row).run();
        tx.update(threads).set({ updatedAt: timestamp }).where(eq(threads.id, thread.id)).run();
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw invalidInput('Candidate action already added', {
          sourceMessageId: body.sourceMessageId,
          candidateIndex: body.candidateIndex,
        });
      }
      throw error;
    }
    return reply.code(201).send(toItemDto(row));
  });

  app.patch('/api/items/:itemId', { preHandler: app.authenticate }, async (request) => {
    const user = await requireUser(app, request);
    const { itemId } = request.params as { itemId: string };
    const body = updateItemSchema.parse(request.body);
    const row = findMutableItem(app, user.id, itemId);
    if (body.dueAt === null && row.kind === 'reminder') {
      throw invalidInput('A reminder requires dueAt', { dueAt: 'Cannot clear a reminder time' });
    }
    const timestamp = app.now().toISOString();
    const patch: Partial<ItemRow> = { updatedAt: timestamp };
    if (body.title !== undefined) patch.title = body.title;
    if (body.dueAt === null) patch.dueAt = null;
    else if (body.dueAt !== undefined) patch.dueAt = normalizeDueAt(body.dueAt);
    if (body.scheduledAt === null) patch.scheduledAt = null;
    else if (body.scheduledAt !== undefined) patch.scheduledAt = normalizeDueAt(body.scheduledAt);
    app.db.update(items).set(patch).where(eq(items.id, row.id)).run();
    return toItemDto({ ...row, ...patch });
  });

  app.delete('/api/items/:itemId', { preHandler: app.authenticate }, async (request, reply) => {
    const user = await requireUser(app, request);
    const { itemId } = request.params as { itemId: string };
    const row = findItem(app, user.id, itemId);
    if (!row) throw notFound('Item not found');
    app.db
      .update(items)
      .set({ status: 'deleted', updatedAt: app.now().toISOString() })
      .where(eq(items.id, row.id))
      .run();
    return reply.code(204).send();
  });

  app.post('/api/items/:itemId/complete', { preHandler: app.authenticate }, async (request) => {
    const user = await requireUser(app, request);
    const { itemId } = request.params as { itemId: string };
    const row = findMutableItem(app, user.id, itemId);
    const timestamp = app.now().toISOString();
    app.db.update(items).set({ status: 'done', updatedAt: timestamp }).where(eq(items.id, row.id)).run();
    return toItemDto({ ...row, status: 'done', updatedAt: timestamp });
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String((error as { code?: unknown }).code).startsWith('SQLITE_CONSTRAINT')
  );
}

function findItem(app: FastifyInstance, userId: string, itemId: string): ItemRow | undefined {
  return app.db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.userId, userId)))
    .get();
}

function findMutableItem(app: FastifyInstance, userId: string, itemId: string): ItemRow {
  const row = findItem(app, userId, itemId);
  if (!row || row.status === 'deleted') throw notFound('Item not found');
  return row;
}
