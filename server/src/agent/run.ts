import { randomUUID } from 'node:crypto';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai';
import type { Db } from '../db';
import { items, messages, type ItemRow, type MessageRow, type ThreadRow } from '../db/schema';
import type { MessagePayload, ToolName, ToolTrace } from '../domain';
import { isRecord } from '../lib/dto';
import type { AgentRuntime } from './runtime';
import { buildSystemPrompt } from './prompt';
import { createAgentTools } from './tools';
import { Staging } from './staging';

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export type AgentRunFailure = 'failed' | 'unfinished';

export class AgentRunError extends Error {
  constructor(
    readonly kind: AgentRunFailure,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AgentRunError';
  }
}

export interface RunAgentInput {
  db: Db;
  runtime: AgentRuntime;
  thread: ThreadRow;
  userMessageId: string;
  userText: string;
  now: Date;
}

export interface AgentRunResult {
  payload: MessagePayload;
  items: ItemRow[];
  toolCalls: ToolTrace[];
}

export async function runAgent(input: RunAgentInput): Promise<AgentRunResult> {
  const { db, runtime, thread, userMessageId, userText, now } = input;

  const openItems = db
    .select()
    .from(items)
    .where(and(eq(items.userId, thread.userId), eq(items.status, 'open')))
    .orderBy(desc(items.updatedAt))
    .limit(20)
    .all();

  const historyRows = db
    .select()
    .from(messages)
    .where(and(eq(messages.threadId, thread.id), ne(messages.id, userMessageId)))
    .orderBy(desc(sql`${messages.createdAt}`), desc(sql`messages.rowid`))
    .limit(20)
    .all()
    .reverse();

  const staging = new Staging(db, thread.userId, thread.id, now);
  const toolCalls: ToolTrace[] = [];
  const pending = new Map<string, Record<string, unknown>>();

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt({ thread, items: openItems, now }),
      model: runtime.model,
      thinkingLevel: 'low',
      tools: createAgentTools(staging),
      messages: historyRows.map((row) => toAgentMessage(row, runtime)),
    },
    streamFn: runtime.streamFn,
    toolExecution: 'sequential',
    sessionId: thread.id,
    getApiKey: () => runtime.apiKey,
    finishTurn: async ({ message }) => {
      if (message.stopReason === 'error' || message.stopReason === 'aborted') return;
      return staging.isCommitted() ? { action: 'end' } : undefined;
    },
  });

  agent.subscribe((event) => {
    if (event.type === 'tool_execution_start') {
      pending.set(event.toolCallId, asObject(event.args));
      return;
    }
    if (event.type !== 'tool_execution_end') return;
    toolCalls.push({
      id: randomUUID(),
      name: event.toolName as ToolName,
      arguments: pending.get(event.toolCallId) ?? {},
      result: traceResult(event.result, event.isError),
      isError: event.isError,
      createdAt: now.toISOString(),
    });
    pending.delete(event.toolCallId);
  });

  try {
    await agent.prompt(userText);
  } catch (error) {
    // finish may have committed just before a late provider/event failure; keep those writes.
    const committed = staging.getCommitted();
    if (committed) {
      return { payload: committed.payload, items: committed.items, toolCalls };
    }
    throw new AgentRunError('failed', 'Agent run failed', { cause: error });
  }

  const committed = staging.getCommitted();
  if (!committed) {
    const detail = agent.state.errorMessage;
    if (detail) throw new AgentRunError('failed', 'Agent run failed');
    throw new AgentRunError('unfinished', 'Agent did not finish');
  }

  return { payload: committed.payload, items: committed.items, toolCalls };
}

function toAgentMessage(row: MessageRow, runtime: AgentRuntime): AgentMessage {
  const timestamp = Date.parse(row.createdAt);
  if (row.role === 'user') {
    return { role: 'user', content: row.content, timestamp };
  }
  const assistant: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: row.content || '已处理' }],
    api: runtime.model.api,
    provider: runtime.model.provider,
    model: runtime.model.id,
    usage: ZERO_USAGE,
    stopReason: 'stop',
    timestamp,
  };
  return assistant;
}

function asObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function traceResult(value: unknown, isError: boolean): Record<string, unknown> {
  if (isError) {
    return { error: resultText(value) || 'Tool execution failed' };
  }
  if (isRecord(value) && isRecord(value.details)) return value.details;
  return { ok: true };
}

function resultText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.content)) return '';
  return value.content
    .flatMap((block) => {
      if (!isRecord(block)) return [];
      return typeof block.text === 'string' ? [block.text] : [];
    })
    .join('\n');
}
