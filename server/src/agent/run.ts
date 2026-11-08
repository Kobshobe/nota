import { randomUUID } from 'node:crypto';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai';
import type { Db } from '../db';
import { items, messages, type MessageRow, type ThreadRow } from '../db/schema';
import type { MessagePayload, ToolName, ToolTrace } from '../domain';
import { isRecord, parsePayload } from '../lib/dto';
import type { AgentRuntime } from './runtime';
import { buildSystemPrompt } from './prompt';
import { createAgentTools } from './tools';
import { Staging } from './staging';
import { formatToolEnd, formatToolStart, sanitizeLogText } from './tool-log';

export interface RunLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

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
  log?: RunLogger;
}

export interface AgentRunResult {
  payload: MessagePayload;
  toolCalls: ToolTrace[];
  staging: Staging;
}

export async function runAgent(input: RunAgentInput): Promise<AgentRunResult> {
  const { db, runtime, thread, userMessageId, userText, now, log } = input;
  const runStartedAt = Date.now();
  // 格式化与写日志一起兜住：日志出问题也不能让一次运行失败。
  const logInfo = (fields: Record<string, unknown>, line: () => string) => {
    try {
      log?.info(fields, line());
    } catch {
      // 忽略。
    }
  };
  const logWarn = (fields: Record<string, unknown>, line: () => string) => {
    try {
      log?.warn(fields, line());
    } catch {
      // 忽略。
    }
  };

  logInfo({ threadId: thread.id, userMessageId }, () => `agent 运行开始 ${userText.length} 字`);

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
  const pending = new Map<string, { name: ToolName; args: Record<string, unknown> }>();
  const startedAt = new Map<string, number>();

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
      return staging.hasFinished() ? { action: 'end' } : undefined;
    },
  });

  agent.subscribe((event) => {
    if (event.type === 'tool_execution_start') {
      const name = event.toolName as ToolName;
      const args = asObject(event.args);
      pending.set(event.toolCallId, { name, args });
      startedAt.set(event.toolCallId, Date.now());
      logInfo({ tool: name }, () => formatToolStart(name, args));
      return;
    }
    if (event.type !== 'tool_execution_end') return;
    const name = event.toolName as ToolName;
    const result = traceResult(event.result, event.isError);
    const durationMs = Date.now() - (startedAt.get(event.toolCallId) ?? Date.now());
    const fields = { tool: name, durationMs, isError: event.isError };
    if (event.isError) logWarn(fields, () => formatToolEnd(name, result, true, durationMs));
    else logInfo(fields, () => formatToolEnd(name, result, false, durationMs));
    toolCalls.push({
      id: randomUUID(),
      name,
      arguments: pending.get(event.toolCallId)?.args ?? {},
      result,
      isError: event.isError,
      createdAt: now.toISOString(),
    });
    pending.delete(event.toolCallId);
    startedAt.delete(event.toolCallId);
  });

  try {
    await agent.prompt(userText);
  } catch (error) {
    // finish may have staged just before a late provider/event failure; let the caller commit or roll back.
    const payload = staging.getFinishPayload();
    if (payload) {
      logWarn(
        { threadId: thread.id },
        () => withUnfinished(`agent 运行中断，沿用已暂存结果（${toolCalls.length} 次工具调用）`, pending),
      );
      return { payload, toolCalls, staging };
    }
    logWarn(
      { threadId: thread.id },
      () =>
        withUnfinished(
          `agent 运行失败：${errorDetail(error)}（${toolCalls.length} 次工具调用，${formatDuration(Date.now() - runStartedAt)}）`,
          pending,
        ),
    );
    throw new AgentRunError('failed', `Agent run failed: ${errorDetail(error)}`, { cause: error });
  }

  const payload = staging.getFinishPayload();
  if (!payload) {
    // 模型/供应商失败时 pi-agent 会正常 resolve，真实原因只在 errorMessage 里。
    const hasError = Boolean(agent.state.errorMessage);
    const reason = sanitizeLogText(agent.state.errorMessage ?? '') || '未知错误';
    logWarn(
      { threadId: thread.id },
      () =>
        withUnfinished(
          hasError
            ? `agent 运行失败：${reason}（${toolCalls.length} 次工具调用，${formatDuration(Date.now() - runStartedAt)}）`
            : `agent 运行结束但未调用 finish（${toolCalls.length} 次工具调用，${formatDuration(Date.now() - runStartedAt)}）`,
          pending,
        ),
    );
    if (hasError) throw new AgentRunError('failed', `Agent run failed: ${reason}`);
    throw new AgentRunError('unfinished', 'Agent did not finish');
  }

  logInfo(
    { threadId: thread.id },
    () => `agent 运行结束 ${toolCalls.length} 次工具调用 ${formatDuration(Date.now() - runStartedAt)}`,
  );
  return { payload, toolCalls, staging };
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** 运行被中断时，工具可能只有开始没有结束，日志里补一句。 */
function withUnfinished(message: string, pending: Map<string, { name: ToolName }>): string {
  const names = [...pending.values()].map((entry) => entry.name);
  return names.length > 0 ? `${message}，未结束：${names.join('、')}` : message;
}

function errorDetail(error: unknown): string {
  return sanitizeLogText(error instanceof Error ? error.message : String(error));
}

function toAgentMessage(row: MessageRow, runtime: AgentRuntime): AgentMessage {
  const timestamp = Date.parse(row.createdAt);
  if (row.role === 'user') {
    return { role: 'user', content: row.content, timestamp };
  }
  const assistant: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: formatAssistantHistory(row) }],
    api: runtime.model.api,
    provider: runtime.model.provider,
    model: runtime.model.id,
    usage: ZERO_USAGE,
    stopReason: 'stop',
    timestamp,
  };
  return assistant;
}

export function formatAssistantHistory(row: MessageRow): string {
  const payload = parsePayload(row.payloadJson);
  if (!payload) return row.content || '已处理';
  const lines: string[] = [];
  if (payload.title) lines.push(`标题：${payload.title}`);

  // 候选事项优先保留，避免长摘要把 "第 2 条" 的指代上下文截掉。
  if (payload.actions?.length) {
    lines.push('候选事项（从 0 开始编号）：');
    lines.push(
      ...payload.actions.map((action, index) => {
        const meta = [
          action.owner ? `负责人=${action.owner}` : '',
          action.dueAt ? `dueAt=${action.dueAt}` : '',
          action.evidence ? `依据=${action.evidence.slice(0, 160)}` : '',
        ]
          .filter(Boolean)
          .join('；');
        return `${index}. ${action.title}${meta ? `（${meta}）` : ''}`;
      }),
    );
  }

  if (payload.reply) lines.push(`回复：${payload.reply.slice(0, 600)}`);
  if (payload.keyPoints?.length) {
    lines.push('重点：');
    lines.push(...payload.keyPoints.map((point) => `- ${point.slice(0, 300)}`));
  }
  if (payload.summary) lines.push(`摘要：${payload.summary.slice(0, 1600)}`);

  return (lines.join('\n') || row.content || '已处理').slice(0, 4000);
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
