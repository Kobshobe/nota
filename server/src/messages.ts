import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth';
import {
  messages,
  threads,
  toolCalls as toolCallsTable,
  type MessageRow,
  type ThreadRow,
  type UserRow,
} from './db/schema';
import type { Db } from './db';
import type { MessagePayload, ToolName, ToolTrace } from './domain';
import { internal, invalidInput } from './lib/errors';
import { toItemDto, toMessageDto, type ItemDto, type MessageDto } from './lib/dto';
import { DEFAULT_MEETING_TITLE, getOwnedThread } from './threads';
import { getUsage, releaseQuota, reserveQuota, settleQuota, type UsageDto } from './quota';
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
    return sendMessageCore(app, user, thread, {
      content: body.content,
      clientMessageId: body.clientMessageId,
      log: request.log,
      requestId: request.id,
    });
  });
}

export interface SendMessageCoreOptions {
  content: string;
  clientMessageId: string;
  log: FastifyBaseLogger;
  requestId?: string;
}

/**
 * 发送一条用户消息并跑 Agent。
 *
 * 路由与录音任务共用这条路径：额度预扣、幂等、工具轨迹、标题填充都只有一份实现。
 */
export async function sendMessageCore(
  app: FastifyInstance,
  user: UserRow,
  thread: ThreadRow,
  options: SendMessageCoreOptions,
): Promise<SendMessageResponse> {
  const { content, clientMessageId, log, requestId } = options;
  const key = `${thread.id}:${clientMessageId}`;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = (async () => {

  const now = app.now();

  const existingUserMessage = app.db
    .select()
    .from(messages)
    .where(and(eq(messages.threadId, thread.id), eq(messages.clientMessageId, clientMessageId)))
    .get();

  if (existingUserMessage) {
    if (existingUserMessage.content !== content) {
      throw invalidInput('clientMessageId was reused with different content');
    }
    const stored = findStoredResponse(app, existingUserMessage.id);
    if (stored) return stored;
  }

  const userMessageId = existingUserMessage?.id ?? randomUUID();
  // 账本行先落地，额度不足在这里就抛 429，不会留下半条消息。
  const reservation = reserveQuota(app.db, user, app.config, now, {
    idempotencyKey: clientMessageId,
    reason: 'message',
    refId: userMessageId,
  });
  const eventId = reservation.event.id;

  let userMessage: MessageRow;
  if (existingUserMessage) {
    userMessage = existingUserMessage;
  } else {
    userMessage = {
      id: userMessageId,
      threadId: thread.id,
      role: 'user',
      content: content,
      payloadJson: null,
      clientMessageId: clientMessageId,
      userMessageId: null,
      responseJson: null,
      createdAt: now.toISOString(),
    };
    try {
      app.db.insert(messages).values(userMessage).run();
    } catch (error) {
      const raced = app.db
        .select()
        .from(messages)
        .where(and(eq(messages.threadId, thread.id), eq(messages.clientMessageId, clientMessageId)))
        .get();
      // 同一条消息被另一个进程抢先写入：账本行归它，这里不能释放。
      if (raced) {
        const stored = findStoredResponse(app, raced.id);
        if (stored) return stored;
        throw internal('Failed to persist message');
      }
      releaseQuota(app.db, eventId, 'failed', now);
      throw error;
    }
  }


  // 演示开关：留下一次未结账的占用，模拟请求在跑 Agent 期间被掐断。
  // 不调用 fail()，所以额度不会当场退回，只能等清扫回收。
  const stuckPrefix = app.config.demoStuckPrefix;
  if (stuckPrefix && content.trimStart().startsWith(stuckPrefix)) {
    log.warn({ requestId, threadId: thread.id }, 'demo: 模拟中断，额度保持占用');
    throw internal('模拟中断：这次整理没有完成，额度保持占用');
  }

  const fail = async (message: string): Promise<never> => {
    app.db
      .delete(messages)
      .where(or(eq(messages.id, userMessage.id), eq(messages.userMessageId, userMessage.id)))
      .run();
    releaseQuota(app.db, eventId, 'failed', now);
    throw internal(message);
  };

  if (!app.runtime.apiKey) {
    log.warn({ requestId }, 'message request rejected: model key is not configured');
    return fail('DEEPSEEK_API_KEY is not configured');
  }

  const run = await runAgent({
    db: app.db,
    runtime: app.runtime,
    thread,
    userMessageId: userMessage.id,
    userText: content,
    now,
    log: log,
  }).catch(async (error: unknown) => {
    log.error(
      {
        requestId: requestId ?? '-',
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
      resolveUsage: (tx) => getUsage(tx, user, app.config, now),
      staging: run.staging,
      now,
      eventId,
    });
  } catch (error) {
    log.error(
      {
        requestId: requestId ?? '-',
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

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function persistRun(
  app: FastifyInstance,
  input: {
    thread: ThreadRow;
    userMessage: MessageRow;
    assistantMessage: MessageRow;
    toolCalls: ToolTrace[];
    payload: MessagePayload;
    resolveUsage: (tx: Tx) => UsageDto;
    staging: Staging;
    now: Date;
    eventId: string;
  },
): SendMessageResponse {
  const { thread, userMessage, assistantMessage, toolCalls, payload, resolveUsage, staging, now, eventId } =
    input;
  const timestamp = now.toISOString();

  const response = app.db.transaction((tx) => {
    const committed = staging.commitInTransaction(tx);
    // 一轮就是一次：跑到这里说明本次运行成功了，占用转为计费。
    settleQuota(tx, eventId, now);
    const usage = resolveUsage(tx);

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
