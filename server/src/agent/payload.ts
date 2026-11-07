import { z } from 'zod';
import type { CandidateAction, MessagePayload } from '../domain';

const dateTime = z.string().datetime({ offset: true, message: 'Must be an ISO 8601 date-time' });

export const candidateActionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    owner: z.string().max(100).optional(),
    dueAt: dateTime.optional(),
    evidence: z.string().max(1000).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const messagePayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(100).optional(),
    summary: z.string().max(8000).optional(),
    keyPoints: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
    actions: z.array(candidateActionSchema).max(20).optional(),
    reply: z.string().max(4000).optional(),
  })
  .strict();

export function parseMessagePayload(value: unknown): MessagePayload {
  const parsed = messagePayloadSchema.parse(value);
  const payload: MessagePayload = {};
  if (parsed.title !== undefined) payload.title = parsed.title;
  if (parsed.summary !== undefined) payload.summary = parsed.summary;
  if (parsed.keyPoints !== undefined) payload.keyPoints = parsed.keyPoints;
  if (parsed.actions !== undefined) payload.actions = parsed.actions as CandidateAction[];
  if (parsed.reply !== undefined) payload.reply = parsed.reply;
  return payload;
}

export function payloadToJson(payload: MessagePayload): string {
  return JSON.stringify(payload);
}
