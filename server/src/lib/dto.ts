import type { ItemRow, MessageRow, ThreadRow } from '../db/schema';
import type { CandidateAction, ItemStatus, MessagePayload, ThreadKind } from '../domain';

export interface ThreadDto {
  id: string;
  kind: ThreadKind;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  payload?: MessagePayload;
  createdAt: string;
}

export interface ItemDto {
  id: string;
  threadId: string;
  kind: 'reminder' | 'todo';
  title: string;
  dueAt?: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}

export function toThreadDto(row: ThreadRow): ThreadDto {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toMessageDto(row: MessageRow): MessageDto {
  const dto: MessageDto = {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
  };
  const payload = parsePayload(row.payloadJson);
  if (payload) dto.payload = payload;
  return dto;
}

export function toItemDto(row: ItemRow): ItemDto {
  const dto: ItemDto = {
    id: row.id,
    threadId: row.threadId,
    kind: row.kind,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.dueAt) dto.dueAt = row.dueAt;
  return dto;
}

export function parsePayload(json: string | null): MessagePayload | undefined {
  if (!json) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isRecord(raw)) return undefined;
  const payload: MessagePayload = {};
  if (typeof raw.title === 'string') payload.title = raw.title;
  if (typeof raw.summary === 'string') payload.summary = raw.summary;
  if (Array.isArray(raw.keyPoints)) {
    payload.keyPoints = raw.keyPoints.filter((point): point is string => typeof point === 'string');
  }
  if (Array.isArray(raw.actions)) {
    payload.actions = raw.actions.flatMap((action) => {
      const sanitized = sanitizeAction(action);
      return sanitized ? [sanitized] : [];
    });
  }
  if (typeof raw.reply === 'string') payload.reply = raw.reply;
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function sanitizeAction(value: unknown): CandidateAction | undefined {
  if (!isRecord(value) || typeof value.title !== 'string' || value.title.length === 0) return undefined;
  const action: CandidateAction = { title: value.title };
  if (typeof value.owner === 'string') action.owner = value.owner;
  if (typeof value.dueAt === 'string') action.dueAt = value.dueAt;
  if (typeof value.evidence === 'string') action.evidence = value.evidence;
  if (typeof value.confidence === 'number') action.confidence = value.confidence;
  return action;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
