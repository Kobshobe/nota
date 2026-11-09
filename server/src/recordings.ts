import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ensureDailyThread, requireUser } from './auth';
import {
  messages,
  recordings,
  threads,
  usageEvents,
  users,
  type RecordingRow,
  type ThreadRow,
} from './db/schema';
import { DEFAULT_MEETING_TITLE } from './threads';
import {
  AppError,
  invalidInput,
  notFound,
  payloadTooLarge,
  transcriptionFailed,
  unsupportedAudio,
} from './lib/errors';
import { formatTranscript } from './asr/transcript';
import { isKnownAudio } from './asr/audio';
import { sendMessageCore } from './messages';
import { parsePayload } from './lib/dto';
import { releaseQuota } from './quota';

/** 同一条录音同一时刻只跑一个任务。 */
const active = new Set<string>();

export interface RecordingDto {
  id: string;
  status: 'transcribing' | 'completed' | 'failed';
  createdAt: string;
  threadId?: string;
  durationMs?: number;
  errorCode?: string;
}

export function registerRecordingRoutes(app: FastifyInstance): void {
  app.post(
    '/api/recordings',
    {
      preHandler: app.authenticate,
      bodyLimit: app.config.recordingMaxBytes + 1024 * 1024,
    },
    async (request, reply) => {
      const user = await requireUser(app, request);
      const uploadKey = readIdempotencyKey(request);

      if (uploadKey) {
        const existing = app.db
          .select()
          .from(recordings)
          .where(and(eq(recordings.userId, user.id), eq(recordings.uploadKey, uploadKey)))
          .get();
        if (existing) {
          // 重传：不新建录音、不重新转写，直接回报既有记录的当前状态。
          request.raw.resume();
          return reply.code(202).send(toRecordingDto(existing));
        }
      }

      let file;
      try {
        file = await request.file({
          limits: { fileSize: app.config.recordingMaxBytes, files: 1, fields: 8 },
        });
      } catch (error) {
        throw mapMultipartError(error, app.config.recordingMaxBytes);
      }
      if (!file) throw invalidInput('audio file is required');

      const id = randomUUID();
      const extension = path.extname(file.filename).toLowerCase();
      const audioPath = path.join(app.config.recordingsPath, `${id}${extension}`);
      // 先按扩展名校验格式，避免把不支持的容器写进磁盘。
      if (!isKnownAudio(audioPath)) {
        throw unsupportedAudio(`Unsupported audio format: ${extension || 'unknown'}`);
      }

      let audio: Buffer;
      try {
        audio = await file.toBuffer();
      } catch (error) {
        throw mapMultipartError(error, app.config.recordingMaxBytes);
      }
      if (audio.length === 0) throw invalidInput('audio file is empty');

      const durationMs = parseDuration(file.fields as Record<string, unknown>);
      if (durationMs !== undefined && durationMs > app.config.recordingMaxSeconds * 1000) {
        throw invalidInput('recording is longer than the limit', {
          maxSeconds: app.config.recordingMaxSeconds,
        });
      }

      await mkdir(app.config.recordingsPath, { recursive: true });
      await writeFile(audioPath, audio);

      // Web 录出来的是 webm，转成 m4a 再存；失败时别把原件留在磁盘上。
      let storedPath: string;
      try {
        storedPath = await app.prepareAudio(audioPath);
      } catch (error) {
        await rm(audioPath, { force: true });
        throw error;
      }

      const now = app.now().toISOString();
      const row: RecordingRow = {
        id,
        userId: user.id,
        deviceId: null,
        status: 'transcribing',
        uploadKey: uploadKey ?? null,
        mimeType: file.mimetype || 'application/octet-stream',
        sizeBytes: audio.length,
        durationMs: durationMs ?? null,
        audioPath: storedPath,
        transcriptJson: null,
        threadId: null,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      };
      app.db.insert(recordings).values(row).run();

      request.log.info(
        { recordingId: row.id, bytes: row.sizeBytes, durationMs: row.durationMs },
        'recording uploaded',
      );
      void processRecording(app, row.id);

      return reply.code(202).send(toRecordingDto(row));
    },
  );

  app.get(
    '/api/recordings/:recordingId',
    { preHandler: app.authenticate },
    async (request) => {
      const user = await requireUser(app, request);
      const { recordingId } = request.params as { recordingId: string };
      return toRecordingDto(getOwnedRecording(app, user.id, recordingId));
    },
  );

  app.post(
    '/api/recordings/:recordingId/retry',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const user = await requireUser(app, request);
      const { recordingId } = request.params as { recordingId: string };
      const row = getOwnedRecording(app, user.id, recordingId);
      if (row.status === 'transcribing') {
        return reply.code(202).send(toRecordingDto(row));
      }
      if (row.status !== 'failed') {
        throw invalidInput('only failed recordings can be retried');
      }
      if (!row.audioPath) {
        throw invalidInput('recording audio is no longer available');
      }

      const now = app.now().toISOString();
      app.db
        .update(recordings)
        .set({ status: 'transcribing', errorCode: null, errorMessage: null, updatedAt: now })
        .where(eq(recordings.id, row.id))
        .run();

      const updated = { ...row, status: 'transcribing' as const, errorCode: null, errorMessage: null, updatedAt: now };
      request.log.info({ recordingId: row.id }, 'recording retry requested');
      void processRecording(app, row.id);
      return reply.code(202).send(toRecordingDto(updated));
    },
  );
}

function getOwnedRecording(app: FastifyInstance, userId: string, recordingId: string): RecordingRow {
  const row = app.db
    .select()
    .from(recordings)
    .where(and(eq(recordings.id, recordingId), eq(recordings.userId, userId)))
    .get();
  if (!row) throw notFound('Recording not found');
  return row;
}

/** 读 `Idempotency-Key`。缺失返回 undefined；格式不对按 400 拒绝，不静默忽略。 */
function readIdempotencyKey(request: FastifyRequest): string | undefined {
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === '') return undefined;
  if (value.length < 8 || value.length > 64) {
    throw invalidInput('Idempotency-Key must be 8 to 64 characters');
  }
  return value;
}

function parseDuration(fields: Record<string, unknown>): number | undefined {
  const raw = fields['durationMs'] as { value?: unknown } | undefined;
  const value = raw?.value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function mapMultipartError(error: unknown, maxBytes: number): AppError {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    return payloadTooLarge('audio file is too large', { maxBytes });
  }
  return error instanceof AppError ? error : invalidInput('malformed multipart request');
}

export function toRecordingDto(row: RecordingRow): RecordingDto {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    ...(row.status === 'completed' && row.threadId ? { threadId: row.threadId } : {}),
    ...(row.durationMs !== null ? { durationMs: row.durationMs } : {}),
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
  };
}

/** 转写 → 建会（只在成功时）→ 首条消息走完整 Agent 管线 → 删音频。 */
export async function processRecording(app: FastifyInstance, recordingId: string): Promise<void> {
  if (active.has(recordingId)) return;
  active.add(recordingId);
  try {
    await runRecording(app, recordingId);
  } finally {
    active.delete(recordingId);
  }
}

async function runRecording(app: FastifyInstance, recordingId: string): Promise<void> {
  const row = app.db.select().from(recordings).where(eq(recordings.id, recordingId)).get();
  if (!row || row.status !== 'transcribing') return;

  try {
    if (!row.audioPath) throw transcriptionFailed('recording audio is missing');
    const transcript = await app.transcribeAudio(row.audioPath);
    if (transcript.durationSec > app.config.recordingMaxSeconds) {
      throw transcriptionFailed('recording is longer than the limit', {
        maxSeconds: app.config.recordingMaxSeconds,
        durationSec: transcript.durationSec,
      });
    }
    const thread = ensureThread(app, row);
    const user = app.db.select().from(users).where(eq(users.id, row.userId)).get();
    if (!user) throw transcriptionFailed('recording owner is missing');

    await sendMessageCore(app, user, thread, {
      content: formatTranscript(transcript),
      clientMessageId: clientMessageIdFor(row.id),
      log: app.log,
      requestId: `recording:${row.id}`,
    });

    // 先删音频再置 completed：客户端看到 completed 时，磁盘上已经没有这段录音。
    if (row.audioPath) {
      await rm(row.audioPath, { force: true }).catch((error: unknown) => {
        app.log.warn(
          { recordingId: row.id, error: error instanceof Error ? error.message : 'unknown' },
          'recording audio could not be removed',
        );
      });
    }

    app.db
      .update(recordings)
      .set({
        status: 'completed',
        transcriptJson: JSON.stringify(transcript),
        audioPath: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: app.now().toISOString(),
      })
      .where(eq(recordings.id, row.id))
      .run();
    app.log.info(
      { recordingId: row.id, threadId: thread.id, speakers: transcript.speakerCount ?? 0 },
      'recording completed',
    );

    // 设备在别处录音，App 这边可能没打开：在拥有者的日常对话里留一条能点进会议的通知。
    if (row.deviceId) {
      try {
        notifyDeviceMinutesReady(app, row.userId, thread.id);
      } catch (error) {
        app.log.warn(
          { recordingId: row.id, threadId: thread.id, error: error instanceof Error ? error.message : 'unknown' },
          'device meeting notice could not be written',
        );
      }
    }
  } catch (error) {
    const errorCode =
      error instanceof AppError && error.code === 'QUOTA_EXCEEDED'
        ? 'QUOTA_EXCEEDED'
        : 'TRANSCRIPTION_FAILED';
    const message = error instanceof Error ? error.message : 'unknown error';

    // 失败时如果会议还没写下任何消息，就把它删掉：时间线里不出现空会议。
    const threadId = app.db
      .select({ threadId: recordings.threadId })
      .from(recordings)
      .where(eq(recordings.id, row.id))
      .get()?.threadId;
    let keepThreadId = threadId ?? null;
    if (threadId) {
      const count =
        app.db
          .select({ count: sql<number>`count(*)` })
          .from(messages)
          .where(eq(messages.threadId, threadId))
          .get()?.count ?? 0;
      if (count === 0) {
        app.db.delete(threads).where(eq(threads.id, threadId)).run();
        keepThreadId = null;
      }
    }

    app.db
      .update(recordings)
      .set({
        status: 'failed',
        threadId: keepThreadId,
        errorCode,
        errorMessage: message.slice(0, 500),
        updatedAt: app.now().toISOString(),
      })
      .where(eq(recordings.id, row.id))
      .run();
    app.log.error(
      { recordingId: row.id, errorCode, errorName: error instanceof Error ? error.name : 'Unknown' },
      'recording failed',
    );
  }
}

/**
 * 设备会议整理完成后，在拥有者的日常对话里写一条 system 消息。
 * 同一条会议只写一次；通知失败不应该影响已经完成的会议。
 */
function notifyDeviceMinutesReady(
  app: FastifyInstance,
  userId: string,
  meetingThreadId: string,
): void {
  const now = app.now();
  const timestamp = now.toISOString();
  const meeting = app.db.select().from(threads).where(eq(threads.id, meetingThreadId)).get();
  if (!meeting) return;
  const daily = ensureDailyThread(app.db, userId, now);
  const alreadyNotified = app.db
    .select()
    .from(messages)
    .where(and(eq(messages.threadId, daily.id), eq(messages.role, 'system')))
    .all()
    .some((message) => parsePayload(message.payloadJson)?.meetingThreadId === meetingThreadId);
  if (alreadyNotified) return;
  app.db.transaction((tx) => {
    tx.insert(messages)
      .values({
        id: randomUUID(),
        threadId: daily.id,
        role: 'system',
        content: `设备录音已整理成会议：${meeting.title}`,
        payloadJson: JSON.stringify({ meetingThreadId }),
        clientMessageId: null,
        userMessageId: null,
        responseJson: null,
        createdAt: timestamp,
      })
      .run();
    tx.update(threads).set({ updatedAt: timestamp }).where(eq(threads.id, daily.id)).run();
  });
}

/** 会议创建与录音的 threadId 写在同一个事务里：重试只会复用，不会建第二场会。 */
function ensureThread(app: FastifyInstance, row: RecordingRow): ThreadRow {
  if (row.threadId) {
    const existing = app.db.select().from(threads).where(eq(threads.id, row.threadId)).get();
    if (existing) return existing;
  }
  const now = app.now().toISOString();
  const thread: ThreadRow = {
    id: randomUUID(),
    userId: row.userId,
    kind: 'meeting',
    title: DEFAULT_MEETING_TITLE,
    createdAt: now,
    updatedAt: now,
  };
  app.db.transaction((tx) => {
    tx.insert(threads).values(thread).run();
    tx.update(recordings)
      .set({ threadId: thread.id, updatedAt: now })
      .where(eq(recordings.id, row.id))
      .run();
  });
  return thread;
}

function clientMessageIdFor(recordingId: string): string {
  return `rec:${recordingId}`;
}

/** 服务启动时把被进程重启打断的任务对账成终态，并清理过期音频。 */
export async function recoverRecordings(app: FastifyInstance): Promise<void> {
  const now = app.now();
  // 启动瞬间本进程没有任何存活任务，所以全部 transcribing 都是上次进程留下的。
  const stale = app.db
    .select()
    .from(recordings)
    .where(eq(recordings.status, 'transcribing'))
    .all();
  for (const row of stale) {
    const threadId = row.threadId;
    const threadMessages = threadId
      ? app.db.select().from(messages).where(eq(messages.threadId, threadId)).all()
      : [];
    const recordingMessage = threadMessages.find(
      (message) =>
        message.role === 'user' && message.clientMessageId === clientMessageIdFor(row.id),
    );
    const assistantMessage = recordingMessage
      ? threadMessages.find(
          (message) =>
            message.role === 'assistant' && message.userMessageId === recordingMessage.id,
        )
      : undefined;

    // Agent 已经写完这条录音的 assistant 消息：这场会议实际已经完成，补回 completed。
    if (assistantMessage) {
      if (row.audioPath) await rm(row.audioPath, { force: true });
      app.db
        .update(recordings)
        .set({
          status: 'completed',
          audioPath: null,
          errorCode: null,
          errorMessage: null,
          updatedAt: now.toISOString(),
        })
        .where(eq(recordings.id, row.id))
        .run();
      continue;
    }

    // 只写了录音的用户消息就中断：退回已扣额度，删掉这条录音的消息和空会议。
    let keepThreadId = threadId;
    if (threadId) {
      if (recordingMessage) {
        const event = app.db
          .select()
          .from(usageEvents)
          .where(
            and(
              eq(usageEvents.userId, row.userId),
              eq(usageEvents.idempotencyKey, clientMessageIdFor(row.id)),
            ),
          )
          .get();
        if (event) releaseQuota(app.db, event.id, 'stale', now);
        app.db.delete(messages).where(eq(messages.userMessageId, recordingMessage.id)).run();
        app.db.delete(messages).where(eq(messages.id, recordingMessage.id)).run();
      }
      const remaining =
        app.db
          .select({ count: sql<number>`count(*)` })
          .from(messages)
          .where(eq(messages.threadId, threadId))
          .get()?.count ?? 0;
      if (remaining === 0) {
        app.db.delete(threads).where(eq(threads.id, threadId)).run();
        keepThreadId = null;
      }
    }

    app.db
      .update(recordings)
      .set({
        status: 'failed',
        threadId: keepThreadId,
        errorCode: 'INTERRUPTED',
        errorMessage: 'The server restarted while transcribing',
        updatedAt: now.toISOString(),
      })
      .where(eq(recordings.id, row.id))
      .run();
  }
  if (stale.length > 0) {
    app.log.warn({ count: stale.length }, 'recordings reconciled after restart');
  }

  await cleanupExpiredAudio(app, now);
}

async function cleanupExpiredAudio(app: FastifyInstance, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - app.config.recordingRetentionHours * 3600 * 1000);
  const expired = app.db
    .select()
    .from(recordings)
    .where(and(eq(recordings.status, 'failed'), lt(recordings.updatedAt, cutoff.toISOString())))
    .all();
  for (const row of expired) {
    if (row.audioPath) await rm(row.audioPath, { force: true });
    app.db
      .update(recordings)
      .set({ audioPath: null, updatedAt: now.toISOString() })
      .where(eq(recordings.id, row.id))
      .run();
  }

  let files: string[] = [];
  try {
    files = await readdir(app.config.recordingsPath);
  } catch {
    return;
  }
  const known = new Set(
    app.db
      .select({ audioPath: recordings.audioPath })
      .from(recordings)
      .where(sql`${recordings.audioPath} is not null`)
      .all()
      .map((row) => row.audioPath),
  );
  for (const name of files) {
    const full = path.join(app.config.recordingsPath, name);
    if (known.has(full)) continue;
    const info = await stat(full).catch(() => undefined);
    if (!info) continue;
    if (info.mtime < cutoff) await rm(full, { force: true });
  }
}
