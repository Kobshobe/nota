import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth';
import {
  messages,
  threads,
  toolCalls as toolCallsTable,
  type MessageRow,
  type ThreadRow,
} from './db/schema';
import type { MessagePayload, ToolName, ToolTrace } from './domain';
import { internal, invalidInput } from './lib/errors';
import { toItemDto, toMessageDto, type ItemDto, type MessageDto } from './lib/dto';
import { dayInTimeZone } from './lib/time';
import { DEFAULT_MEETING_TITLE, getOwnedThread } from './threads';
import { chargeQuota, getUsage, refundQuota, type UsageDto } from './quota';
import { AgentRunError, runAgent } from './agent/run';
import type { Staging } from './agent/staging';
import { payloadToJson } from './agent/payload';

const sendMessageSchema = z
  .object({
    content: z.string().min(1).max(20000),
    clientMessageId: z.string().min(8).max(64),
  })
  .strict();

interface ToolCallDto {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: string;
}

interface SendMessageResponse {
  userMessage: MessageDto;
  assistantMessage: MessageDto;
  toolCalls: ToolCallDto[];
  items: ItemDto[];
  usage: UsageDto;
}

const inFlight = new Map<string, Promise<SendMessageResponse>>();

export function registerMessageRoutes(app: FastifyInstance): void {
  app.post('/api/threads/:threadId/messages', { preHandler: app.authenticate }, async (request) => {
    const user = await requireUser(app, request);
    const { threadId } = request.params as { threadId: string };
    const thread = getOwnedThread(app, user.id, threadId);
    const body = sendMessageSchema.parse(request.body);
    const key = `${thread.id}:${body.clientMessageId}`;
    const pending = inFlight.get(key);
    if (pending) return pending;

    const task = (async () => {
      const now = app.now();

      const existingUserMessage = app.db
        .select()
        .from(messages)
        .where(and(eq(messages.threadId, thread.id), eq(messages.clientMessageId, body.clientMessageId)))
        .get();

      if (existingUserMessage) {
        const stored = findStoredResponse(app, existingUserMessage.id);
        if (stored) return stored;
      }

      let userMessage: MessageRow;
      let chargedDay: string | undefined;
      if (existingUserMessage) {
        if (existingUserMessage.content !== body.content) {
          throw invalidInput('clientMessageId was reused with different content');
        }
        userMessage = existingUserMessage;
        const originalDay = dayInTimeZone(
          new Date(existingUserMessage.createdAt),
          app.config.quotaTimezone,
        );
        const currentDay = dayInTimeZone(now, app.config.quotaTimezone);
        if (originalDay !== currentDay) {
          refundQuota(app.db, user.id, originalDay, now);
          chargedDay = chargeQuota(app.db, user, app.config, now).day;
        } else {
          chargedDay = originalDay;
        }
      } else {
        const charge = chargeQuota(app.db, user, app.config, now);
        chargedDay = charge.day;
        userMessage = {
          id: randomUUID(),
          threadId: thread.id,
          role: 'user',
          content: body.content,
          payloadJson: null,
          clientMessageId: body.clientMessageId,
          userMessageId: null,
          responseJson: null,
          createdAt: now.toISOString(),
        };
        try {
          app.db.insert(messages).values(userMessage).run();
        } catch (error) {
          refundQuota(app.db, user.id, chargedDay, now);
          throw error;
        }
      }

      const fail = async (message: string): Promise<never> => {
        app.db
          .delete(messages)
          .where(or(eq(messages.id, userMessage.id), eq(messages.userMessageId, userMessage.id)))
          .run();
        if (chargedDay) refundQuota(app.db, user.id, chargedDay, now);
        throw internal(message);
      };

      if (!app.runtime.apiKey) {
        request.log.warn({ requestId: request.id }, 'message request rejected: model key is not configured');
        return fail('DEEPSEEK_API_KEY is not configured');
      }

      const run = await runAgent({
        db: app.db,
        runtime: app.runtime,
        thread,
        userMessageId: userMessage.id,
        userText: body.content,
        now,
      }).catch(async (error: unknown) => {
        request.log.error(
          {
            requestId: request.id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message : 'unknown',
          },
          'agent run failed',
        );
        return fail(
          error instanceof AgentRunError && error.kind === 'unfinished'
            ? 'Agent did not finish'
            : 'Agent run failed',
        );
      });

      const payload = run.payload;
      const assistantContent =
        payload.reply?.trim() || payload.summary?.trim() || payload.title?.trim() || '已处理';
      const assistantMessage: MessageRow = {
        id: randomUUID(),
        threadId: thread.id,
        role: 'assistant',
        content: assistantContent,
        payloadJson: payloadToJson(payload),
        clientMessageId: null,
        userMessageId: userMessage.id,
        responseJson: null,
        createdAt: now.toISOString(),
      };

      try {
        return persistRun(app, {
          thread,
          userMessage,
          assistantMessage,
          toolCalls: run.toolCalls,
          payload,
          usage: getUsage(app.db, user, app.config, now),
          staging: run.staging,
          now,
        });
      } catch (error) {
        request.log.error(
          {
            requestId: request.id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message : 'unknown',
          },
          'message persistence failed',
        );
        return fail('Failed to persist message');
      }
    })();
    inFlight.set(key, task);
    try {
      return await task;
    } finally {
      if (inFlight.get(key) === task) inFlight.delete(key);
    }
  });
}

function findStoredResponse(app: FastifyInstance, userMessageId: string): SendMessageResponse | undefined {
  const assistant = app.db
    .select()
    .from(messages)
    .where(and(eq(messages.userMessageId, userMessageId), eq(messages.role, 'assistant')))
    .get();
  if (!assistant?.responseJson) return undefined;
  try {
    return JSON.parse(assistant.responseJson) as SendMessageResponse;
  } catch {
    return undefined;
  }
}

function persistRun(
  app: FastifyInstance,
  input: {
    thread: ThreadRow;
    userMessage: MessageRow;
    assistantMessage: MessageRow;
    toolCalls: ToolTrace[];
    payload: MessagePayload;
    usage: UsageDto;
    staging: Staging;
    now: Date;
  },
): SendMessageResponse {
  const { thread, userMessage, assistantMessage, toolCalls, payload, usage, staging, now } = input;
  const timestamp = now.toISOString();

  const response = app.db.transaction((tx) => {
    const committed = staging.commitInTransaction(tx);

    const priorAssistants =
      tx
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(and(eq(messages.threadId, thread.id), eq(messages.role, 'assistant')))
        .get()?.count ?? 0;

    tx.insert(messages).values(assistantMessage).run();

    if (toolCalls.length > 0) {
      tx.insert(toolCallsTable)
        .values(
          toolCalls.map((trace) => ({
            id: trace.id,
            messageId: assistantMessage.id,
            toolCallId: trace.id,
            name: trace.name,
            argumentsJson: JSON.stringify(trace.arguments),
            resultJson: JSON.stringify(trace.result),
            createdAt: trace.createdAt,
          })),
        )
        .run();
    }

    const shouldFillTitle =
      thread.kind === 'meeting' &&
      thread.title === DEFAULT_MEETING_TITLE &&
      priorAssistants === 0 &&
      payload.title !== undefined;

    tx.update(threads)
      .set({
        title: shouldFillTitle ? payload.title : thread.title,
        updatedAt: timestamp,
      })
      .where(eq(threads.id, thread.id))
      .run();

    const result: SendMessageResponse = {
      userMessage: toMessageDto(userMessage),
      assistantMessage: toMessageDto(assistantMessage),
      toolCalls: toolCalls.map((trace) => ({
        id: trace.id,
        name: trace.name,
        arguments: trace.arguments,
        result: trace.result,
        createdAt: trace.createdAt,
      })),
      items: committed.items.map(toItemDto),
      usage,
    };

    tx.update(messages)
      .set({ responseJson: JSON.stringify(result) })
      .where(eq(messages.id, assistantMessage.id))
      .run();

    return { response: result, committed };
  });

  staging.markCommitted(response.committed);
  return response.response;
}

export type { SendMessageResponse, ToolCallDto };
