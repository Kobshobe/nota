import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createModels } from '@earendil-works/pi-ai';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type FauxProviderHandle,
} from '@earendil-works/pi-ai/providers/faux';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp } from '../src/app';
import type { AppConfig } from '../src/config';
import type { AgentRuntime } from '../src/agent/runtime';
import type { Transcript } from '../src/asr/minimax';
import { createDeviceRecord } from '../src/devices';
import { users } from '../src/db/schema';

export interface TestContext {
  app: FastifyInstance;
  config: AppConfig;
  faux: FauxProviderHandle;
  dir: string;
  currentNow: Date;
  setNow: (date: Date) => void;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  demoStuckPrefix?: string;
  dailyLimit?: number;
  apiKey?: string | null;
  now?: Date;
  logger?: FastifyServerOptions['logger'];
  /** 默认 12 MB；调小用于覆盖 413。 */
  recordingMaxBytes?: number;
  /** 默认返回一段固定的双人对话；传 null 表示转写总是失败。 */
  transcript?: Transcript | null;
  /** 完全自定义转写，优先级高于 transcript。 */
  transcribe?: (filePath: string) => Promise<Transcript>;
  /** 覆盖音频准备（转码）步骤；默认原样返回。 */
  prepareAudio?: (filePath: string) => Promise<string>;
}

export const DEFAULT_TRANSCRIPT: Transcript = {
  text: '人都到齐了吧？开始，先说报价这事。报价我重新核了一遍，比上次低了两千。',
  durationSec: 13.7,
  speakerCount: 2,
  segments: [
    { start: 0.2, end: 3.9, speaker: 'S1', text: '人都到齐了吧？开始，先说报价这事。' },
    { start: 4.2, end: 8.6, speaker: 'S2', text: '报价我重新核了一遍，比上次低了两千。' },
  ],
};

export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const dir = mkdtempSync(path.join(tmpdir(), 'nota-test-'));
  const databasePath = path.join(dir, 'nota.db');

  const config: AppConfig = {
    repoRoot: dir,
    port: 0,
    databasePath,
    jwtSecret: 'test-jwt-secret-please-do-not-use-in-production',
    jwtExpiresIn: '7d',
    dailyLimit: options.dailyLimit ?? 10,
    quotaTimezone: 'Asia/Shanghai',
    quotaReserveTtlMinutes: 2,
    demoStuckPrefix: options.demoStuckPrefix,
    deepseekApiKey: options.apiKey === null ? undefined : (options.apiKey ?? 'test-deepseek-key'),
    deepseekBaseUrl: 'https://api.deepseek.com',
    deepseekModel: 'deepseek-flash',
    minimaxApiKey: 'test-minimax-key',
    minimaxAsrBaseUrl: 'https://api.minimax.cn',
    minimaxAsrModel: 'asr-1.0',
    recordingMaxSeconds: 480,
    recordingMaxBytes: options.recordingMaxBytes ?? 12 * 1024 * 1024,
    recordingRetentionHours: 24,
    recordingsPath: path.join(dir, 'recordings'),
    ffmpegPath: 'ffmpeg',
    logLevel: 'silent',
    logFormat: 'json',
  };

  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const runtime: AgentRuntime = {
    model: faux.getModel(),
    streamFn: models.streamSimple.bind(models),
    apiKey: config.deepseekApiKey,
  };

  const clock = { current: options.now ?? new Date('2026-11-08T10:00:00+08:00') };
  const app = await buildApp({
    config,
    databasePath,
    runtime,
    prepareAudio: options.prepareAudio ?? (async (filePath) => filePath),
    transcribeAudio:
      options.transcribe ??
      (async () => {
        if (options.transcript === null) {
          throw new Error('transcription failed in test');
        }
        return options.transcript ?? DEFAULT_TRANSCRIPT;
      }),
    now: () => clock.current,
    logger: options.logger ?? false,
  });

  return {
    app,
    config,
    faux,
    dir,
    get currentNow() {
      return clock.current;
    },
    setNow: (date: Date) => {
      clock.current = date;
    },
    close: async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface CallOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  token?: string;
  payload?: unknown;
}

export interface CallResult<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
}

export async function call<T = any>(
  ctx: TestContext,
  options: CallOptions,
): Promise<CallResult<T>> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const response = await ctx.app.inject({
    method: options.method,
    url: options.url,
    headers,
    payload: options.payload as never,
  });
  let body: T = undefined as T;
  if (response.body.length > 0) {
    try {
      body = JSON.parse(response.body) as T;
    } catch {
      body = response.body as unknown as T;
    }
  }
  return { status: response.statusCode, body, headers: response.headers };
}

export async function login(
  ctx: TestContext,
  email = 'user@example.com',
  password = 'secret123',
): Promise<{ token: string; user: { email: string; isVip: boolean } }> {
  const response = await call(ctx, {
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  if (response.status !== 200) {
    throw new Error(`login failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

export async function createMeeting(
  ctx: TestContext,
  token: string,
  title?: string,
): Promise<{ id: string; kind: string; title: string }> {
  const response = await call(ctx, {
    method: 'POST',
    url: '/api/threads',
    token,
    payload: title === undefined ? { kind: 'meeting' } : { kind: 'meeting', title },
  });
  if (response.status !== 201) {
    throw new Error(`create meeting failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

export async function dailyThreadId(ctx: TestContext, token: string): Promise<string> {
  const response = await call(ctx, { method: 'GET', url: '/api/threads', token });
  const daily = response.body.threads.find((thread: { kind: string }) => thread.kind === 'daily');
  if (!daily) throw new Error('daily thread missing');
  return daily.id;
}

export interface SendOptions {
  clientMessageId?: string;
  threadId?: string;
  content?: string;
}

export async function sendMessage(
  ctx: TestContext,
  token: string,
  content: string,
  options: SendOptions = {},
) {
  const threadId = options.threadId ?? (await dailyThreadId(ctx, token));
  return call(ctx, {
    method: 'POST',
    url: `/api/threads/${threadId}/messages`,
    token,
    payload: {
      content,
      clientMessageId: options.clientMessageId ?? `msg-${randomUUID()}`,
    },
  });
}

export function toolCall(name: string, args: Record<string, unknown>) {
  return fauxToolCall(name, args as never);
}

export function assistantWithTools(
  calls: { name: string; args: Record<string, unknown> }[],
  text?: string,
) {
  const content = calls.map((item) => toolCall(item.name, item.args));
  return fauxAssistantMessage(text === undefined ? content : [fauxText(text), ...content]);
}

export function finishOnly(payload: Record<string, unknown> = { reply: '好的' }) {
  return fauxAssistantMessage(toolCall('finish', payload));
}

export function finishWith(
  calls: { name: string; args: Record<string, unknown> }[],
  payload: Record<string, unknown> = { reply: '已处理' },
) {
  return assistantWithTools([...calls, { name: 'finish', args: payload }]);
}

export function textOnly(text: string) {
  return fauxAssistantMessage(text);
}

export async function createDevice(
  ctx: TestContext,
  email = 'user@example.com',
  name = '测试设备',
): Promise<{ id: string; token: string; userId: string }> {
  const user = ctx.app.db.select().from(users).where(eq(users.email, email)).get();
  if (!user) throw new Error(`user missing: ${email}`);
  const { device, token } = createDeviceRecord(ctx.app.db, {
    userId: user.id,
    name,
    now: ctx.currentNow,
  });
  return { id: device.id, token, userId: user.id };
}
