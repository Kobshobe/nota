import { randomUUID } from 'node:crypto';
import { and, desc, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db';
import { items, type ItemRow } from '../db/schema';
import type { CommittedRun, ItemKind, ItemStatus } from '../domain';
import { toItemDto, type ItemDto } from '../lib/dto';
import { parseMessagePayload } from './payload';

const dateTime = z.string().datetime({ offset: true, message: 'Must be an ISO 8601 date-time' });

type CreateOp = {
  type: 'create';
  tempId: string;
  kind: ItemKind;
  title: string;
  dueAt: string | null;
};

type UpdateOp = {
  type: 'update';
  ref: string;
  title?: string;
  dueAt?: string;
};

type DeleteOp = { type: 'delete'; ref: string };
type CompleteOp = { type: 'complete'; ref: string };
type Operation = CreateOp | UpdateOp | DeleteOp | CompleteOp;

export interface CreateItemInput {
  title: string;
  kind?: ItemKind;
  dueAt?: string;
}

export interface UpdateItemInput {
  title?: string;
  dueAt?: string;
}

export interface SearchItemsInput {
  query?: string;
  status?: ItemStatus;
  threadId?: string;
  limit?: number;
}

export interface StagedItem {
  itemId: string;
  tempId?: string;
  kind?: ItemKind;
  title?: string;
  dueAt?: string;
}

/**
 * Collects item writes for one agent run. Nothing touches SQLite until
 * `commit()` runs inside a single transaction.
 */
export class Staging {
  private readonly operations: Operation[] = [];
  private readonly created = new Map<string, CreateOp>();
  private committed?: CommittedRun;
  private createCount = 0;

  constructor(
    private readonly db: Db,
    private readonly userId: string,
    private readonly threadId: string,
    private readonly now: Date,
  ) {}

  isCommitted(): boolean {
    return this.committed !== undefined;
  }

  getCommitted(): CommittedRun | undefined {
    return this.committed;
  }

  create(input: CreateItemInput): StagedItem {
    this.assertOpen();
    const title = requireTitle(input.title);
    const dueAt = input.dueAt ? normalizeDueAt(input.dueAt) : null;
    const kind: ItemKind = input.kind ?? (dueAt ? 'reminder' : 'todo');
    if (kind === 'reminder' && !dueAt) {
      throw new Error('A reminder requires dueAt');
    }
    const tempId = `new_${++this.createCount}`;
    const operation: CreateOp = { type: 'create', tempId, kind, title, dueAt };
    this.operations.push(operation);
    this.created.set(tempId, operation);
    const staged: StagedItem = { itemId: tempId, tempId, kind, title };
    if (dueAt) staged.dueAt = dueAt;
    return staged;
  }

  update(ref: string, input: UpdateItemInput): StagedItem {
    this.assertOpen();
    const patch: { title?: string; dueAt?: string } = {};
    if (input.title !== undefined) patch.title = requireTitle(input.title);
    if (input.dueAt !== undefined) patch.dueAt = normalizeDueAt(input.dueAt);
    if (patch.title === undefined && patch.dueAt === undefined) {
      throw new Error('Provide title or dueAt');
    }

    const pending = this.created.get(ref);
    if (pending) {
      if (patch.title !== undefined) pending.title = patch.title;
      if (patch.dueAt !== undefined) pending.dueAt = patch.dueAt;
      return { itemId: pending.tempId, tempId: pending.tempId, ...patch };
    }

    this.requireExisting(ref);
    const operation: UpdateOp = { type: 'update', ref, ...patch };
    this.operations.push(operation);
    return { itemId: ref, ...patch };
  }

  delete(ref: string): StagedItem {
    this.assertOpen();
    if (!this.created.has(ref)) this.requireExisting(ref);
    this.operations.push({ type: 'delete', ref });
    return { itemId: ref };
  }

  complete(ref: string): StagedItem {
    this.assertOpen();
    if (!this.created.has(ref)) this.requireExisting(ref);
    this.operations.push({ type: 'complete', ref });
    return { itemId: ref };
  }

  search(input: SearchItemsInput): ItemDto[] {
    const conditions = [eq(items.userId, this.userId)];
    const status = input.status ?? 'open';
    conditions.push(eq(items.status, status));
    if (input.query?.trim()) conditions.push(like(items.title, `%${input.query.trim()}%`));
    if (input.threadId) conditions.push(eq(items.threadId, input.threadId));
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    return this.db
      .select()
      .from(items)
      .where(and(...conditions))
      .orderBy(desc(items.updatedAt))
      .limit(limit)
      .all()
      .map(toItemDto);
  }

  commit(rawPayload: unknown): CommittedRun {
    if (this.committed) return this.committed;
    const payload = parseMessagePayload(rawPayload);
    const timestamp = this.now.toISOString();
    const db = this.db;

    const result = db.transaction((tx) => {
      const idByTemp = new Map<string, string>();
      const touched: string[] = [];

      for (const operation of this.operations) {
        if (operation.type === 'create') {
          const id = randomUUID();
          idByTemp.set(operation.tempId, id);
          tx.insert(items)
            .values({
              id,
              userId: this.userId,
              threadId: this.threadId,
              kind: operation.kind,
              title: operation.title,
              dueAt: operation.dueAt,
              status: 'open',
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .run();
          touched.push(id);
          continue;
        }

        const id = idByTemp.get(operation.ref) ?? operation.ref;
        if (operation.type === 'update') {
          const patch: Partial<ItemRow> = { updatedAt: timestamp };
          if (operation.title !== undefined) patch.title = operation.title;
          if (operation.dueAt !== undefined) patch.dueAt = operation.dueAt;
          tx.update(items)
            .set(patch)
            .where(and(eq(items.id, id), eq(items.userId, this.userId)))
            .run();
        } else if (operation.type === 'delete') {
          tx.update(items)
            .set({ status: 'deleted', updatedAt: timestamp })
            .where(and(eq(items.id, id), eq(items.userId, this.userId)))
            .run();
        } else {
          tx.update(items)
            .set({ status: 'done', updatedAt: timestamp })
            .where(and(eq(items.id, id), eq(items.userId, this.userId)))
            .run();
        }
        touched.push(id);
      }

      const rows: ItemRow[] = [];
      for (const id of new Set(touched)) {
        const row = tx
          .select()
          .from(items)
          .where(and(eq(items.id, id), eq(items.userId, this.userId)))
          .get();
        if (row) rows.push(row);
      }
      return { payload, items: rows };
    });

    this.committed = result;
    return result;
  }

  private assertOpen(): void {
    if (this.committed) {
      throw new Error('finish has already committed this run; no further writes are allowed');
    }
  }

  private requireExisting(ref: string): ItemRow {
    const row = this.db
      .select()
      .from(items)
      .where(and(eq(items.id, ref), eq(items.userId, this.userId)))
      .get();
    if (!row || row.status === 'deleted') {
      throw new Error(`Item not found: ${ref}`);
    }
    return row;
  }
}

function requireTitle(value: string): string {
  const title = value.trim();
  if (title.length === 0) throw new Error('title must not be empty');
  if (title.length > 200) throw new Error('title must be at most 200 characters');
  return title;
}

function normalizeDueAt(value: string): string {
  const parsed = dateTime.safeParse(value);
  if (!parsed.success) {
    throw new Error('dueAt must be an ISO 8601 date-time with an explicit offset');
  }
  return new Date(parsed.data).toISOString();
}
