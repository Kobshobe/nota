import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ensureDailyThread } from './auth';
import { deviceUtterances, messages, users, type DeviceUtteranceRow } from './db/schema';
import { sendMessageCore } from './messages';
import { audioMimeType } from './asr/minimax';
import { refundQuota } from './quota';
import { dayInTimeZone } from './lib/time';
import type { DeviceAuth } from './devices';
import {
  AppError,
  invalidInput,
  internal,
  notFound,
  payloadTooLarge,
  transcriptionFailed,
  unauthorized,
} from './lib/errors';

/** 同一条 utterance 同一时刻只跑一个任务。 */
const active = new Set<string>();

export interface DeviceUtteranceDto {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  createdAt: string;
  replyText?: string;
  replyAudioUrl?: string;
  errorCode?: 'TRANSCRIPTION_FAILED' | 'QUOTA_EXCEEDED' | 'AGENT_FAILED' | 'INTERRUPTED';
}

export function toDeviceUtteranceDto(row: DeviceUtteranceRow): DeviceUtteranceDto {
  const dto: DeviceUtteranceDto = {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
  };
  if (row.replyText) dto.replyText = row.replyText;
  if (row.replyAudioPath && existsSync(row.replyAudioPath)) {
    dto.replyAudioUrl = `/api/device/utterances/${row.id}/reply-audio`;
  }
  if (row.errorCode) dto.errorCode = row.errorCode;
  return dto;
}

export function registerDeviceUtteranceRoutes(app: FastifyInstance): void {
  app.post(
    '/api/device/utterances',
    {
      preHandler: app.authenticateDevice,
      bodyLimit: app.config.deviceMaxBytes + 1024 * 1024,
    },
    async (request, reply) => {
      const auth = requireDeviceAuth(request);

      let filename = '';
      let audio: Buffer | undefined;
      let durationMs: number | undefined;
      try {
        for await (const part of request.parts({
          limits: { fileSize: app.config.deviceMaxBytes, files: 1, fields: 4 },
        })) {
          if (part.type === 'file') {
            const buffer = await part.toBuffer();
            if (part.fieldname !== 'audio') {
              throw invalidInput('unexpected file field');
            }
            filename = part.filename ?? '';
            audio = buffer;
          } else if (part.fieldname === 'durationMs') {
            durationMs = parseDurationMs(part.value);
          }
        }
      } catch (error) {
        throw mapMultipartError(error, app.config.deviceMaxBytes);
      }

      if (!audio || audio.length === 0) throw invalidInput('audio file is required');
      if (audio.length > app.config.deviceMaxBytes) throw payloadTooLarge();
      if (durationMs !== undefined && durationMs > app.config.deviceMaxSeconds * 1000) {
        throw invalidInput('utterance is longer than the limit', {
          maxSeconds: app.config.deviceMaxSeconds,
        });
      }

      const id = randomUUID();
      const extension = path.extname(filename).toLowerCase();
      const audioPath = path.join(app.config.deviceUploadsPath, `${id}${extension || '.bin'}`);
      const mimeType = audioMimeType(audioPath);

      await mkdir(app.config.deviceUploadsPath, { recursive: true });
      await writeFile(audioPath, audio);

      const now = app.now().toISOString();
      const row: DeviceUtteranceRow = {
        id,
        deviceId: auth.device.id,
        userId: auth.user.id,
        status: 'processing',
        mimeType,
        sizeBytes: audio.length,
        durationMs: durationMs ?? null,
        audioPath,
        transcriptJson: null,
        replyText: null,
        replyAudioPath: null,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      };
      app.db.insert(deviceUtterances).values(row).run();

      request.log.info(
        { utteranceId: row.id, deviceId: row.deviceId, bytes: row.sizeBytes },
        'device utterance uploaded',
      );
      void processDeviceUtterance(app, row.id).catch((error: unknown) => {
        request.log.error(
          {
            utteranceId: row.id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message : 'unknown',
          },
          'device utterance task crashed',
        );
        try {
          app.db
            .update(deviceUtterances)
            .set({
              status: 'failed',
              audioPath: null,
              replyAudioPath: null,
              errorCode: 'INTERRUPTED',
              errorMessage: 'device task crashed',
              updatedAt: app.now().toISOString(),
            })
            .where(
              and(
                eq(deviceUtterances.id, row.id),
                eq(deviceUtterances.status, 'processing'),
              ),
            )
            .run();
        } catch (updateError) {
          request.log.error(
            {
              utteranceId: row.id,
              errorName: updateError instanceof Error ? updateError.name : 'UnknownError',
            },
            'device utterance crash could not be recorded',
          );
        }
      });

      return reply.code(202).send(toDeviceUtteranceDto(row));
    },
  );

  app.get(
    '/api/device/utterances/:utteranceId',
    { preHandler: app.authenticateDevice },
    async (request) => {
      const auth = requireDeviceAuth(request);
      const { utteranceId } = request.params as { utteranceId: string };
      return toDeviceUtteranceDto(findOwned(app, auth.device.id, utteranceId));
    },
  );

  app.get(
    '/api/device/utterances/:utteranceId/reply-audio',
    { preHandler: app.authenticateDevice },
    async (request, reply) => {
      const auth = requireDeviceAuth(request);
      const { utteranceId } = request.params as { utteranceId: string };
      const row = findOwned(app, auth.device.id, utteranceId);
      if (row.status !== 'completed' || !row.replyAudioPath || !existsSync(row.replyAudioPath)) {
        throw notFound('Reply audio not found');
      }
      const info = await stat(row.replyAudioPath);
      const maxAgeMs = app.config.ttsRetentionHours * 60 * 60 * 1000;
      if (app.now().getTime() - info.mtimeMs > maxAgeMs) {
        await rm(row.replyAudioPath, { force: true }).catch(() => undefined);
        throw notFound('Reply audio expired');
      }
      return reply
        .type('audio/mpeg')
        .header('content-length', String(info.size))
        .send(createReadStream(row.replyAudioPath));
    },
  );
}

/** 上传后的异步管线：ASR → 日常 thread → Agent → TTS。 */
export async function processDeviceUtterance(
  app: FastifyInstance,
  utteranceId: string,
): Promise<void> {
  if (active.has(utteranceId)) return;
  active.add(utteranceId);
  try {
    await runDeviceUtterance(app, utteranceId);
  } finally {
    active.delete(utteranceId);
  }
}

async function runDeviceUtterance(
  app: FastifyInstance,
  utteranceId: string,
): Promise<void> {
  const row = app.db
    .select()
    .from(deviceUtterances)
    .where(eq(deviceUtterances.id, utteranceId))
    .get();
  if (!row || row.status !== 'processing') return;

  let stage: 'transcription' | 'agent' = 'transcription';
  let preparedPath: string | undefined;

  try {
    if (!row.audioPath) throw transcriptionFailed('device utterance audio is missing');
    preparedPath = await app.prepareAudio(row.audioPath);
    const transcript = await app.transcribeAudio(preparedPath);
    if (transcript.durationSec > app.config.deviceMaxSeconds) {
      throw transcriptionFailed('utterance is longer than the limit', {
        maxSeconds: app.config.deviceMaxSeconds,
        durationSec: transcript.durationSec,
      });
    }

    stage = 'agent';
    const user = app.db.select().from(users).where(eq(users.id, row.userId)).get();
    if (!user) throw internal('device utterance owner is missing');
    const thread = ensureDailyThread(app.db, user.id, app.now());
    const response = await sendMessageCore(app, user, thread, {
      content: transcript.text,
      clientMessageId: `dev:${row.id}`,
      log: app.log,
      requestId: `device:${row.id}`,
    });

    const replyText = capSpeechText(response.assistantMessage.content, app.config.ttsMaxChars);
    let replyAudioPath: string | null = null;
    if (replyText) {
      try {
        const audio = await app.synthesizeSpeech(replyText);
        await mkdir(app.config.ttsPath, { recursive: true });
        const target = path.join(app.config.ttsPath, `${row.id}.mp3`);
        await writeFile(target, audio);
        replyAudioPath = target;
      } catch (error) {
        // 结果已经写进 App；没有音频只影响设备播放，不把整条标失败。
        app.log.warn(
          {
            utteranceId: row.id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message : 'unknown',
          },
          'device reply speech failed',
        );
      }
    }

    await cleanupAudio(row.audioPath, preparedPath);
    app.db
      .update(deviceUtterances)
      .set({
        status: 'completed',
        transcriptJson: JSON.stringify(transcript),
        replyText,
        replyAudioPath,
        audioPath: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: app.now().toISOString(),
      })
      .where(eq(deviceUtterances.id, row.id))
      .run();
    app.log.info(
      { utteranceId: row.id, hasAudio: Boolean(replyAudioPath) },
      'device utterance completed',
    );
  } catch (error) {
    const errorCode: NonNullable<DeviceUtteranceRow['errorCode']> =
      error instanceof AppError && error.code === 'QUOTA_EXCEEDED'
        ? 'QUOTA_EXCEEDED'
        : stage === 'transcription'
          ? 'TRANSCRIPTION_FAILED'
          : 'AGENT_FAILED';
    const message = error instanceof Error ? error.message : 'unknown error';

    await cleanupAudio(row.audioPath, preparedPath);
    app.db
      .update(deviceUtterances)
      .set({
        status: 'failed',
        audioPath: null,
        replyAudioPath: null,
        errorCode,
        errorMessage: message.slice(0, 500),
        updatedAt: app.now().toISOString(),
      })
      .where(eq(deviceUtterances.id, row.id))
      .run();
    app.log.error(
      {
        utteranceId: row.id,
        errorCode,
        errorName: error instanceof Error ? error.name : 'Unknown',
      },
      'device utterance failed',
    );
  }
}

function requireDeviceAuth(request: FastifyRequest): DeviceAuth {
  if (!request.deviceAuth) throw unauthorized('Device token required');
  return request.deviceAuth;
}

function findOwned(
  app: FastifyInstance,
  deviceId: string,
  utteranceId: string,
): DeviceUtteranceRow {
  const row = app.db
    .select()
    .from(deviceUtterances)
    .where(
      and(eq(deviceUtterances.id, utteranceId), eq(deviceUtterances.deviceId, deviceId)),
    )
    .get();
  if (!row) throw notFound('Utterance not found');
  return row;
}

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw invalidInput('durationMs must be a positive integer');
  }
  return parsed;
}

function mapMultipartError(error: unknown, maxBytes: number): AppError {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    return payloadTooLarge('audio file is too large', { maxBytes });
  }
  return error instanceof AppError ? error : invalidInput('malformed multipart request');
}

async function cleanupAudio(...paths: (string | null | undefined)[]): Promise<void> {
  for (const target of new Set(paths.filter((value): value is string => Boolean(value)))) {
    await rm(target, { force: true }).catch(() => undefined);
  }
}

/** 口语回复只保留一段；超长时按码点截到最后一个句末标点。 */
export function capSpeechText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const characters = Array.from(normalized);
  if (characters.length <= maxChars) return normalized;
  const clipped = characters.slice(0, maxChars);
  let cut = -1;
  for (let index = clipped.length - 1; index >= 0; index -= 1) {
    const character = clipped[index];
    if (character === '。' || character === '！' || character === '？' || character === '；') {
      cut = index;
      break;
    }
    if (character === '.') {
      const next = clipped[index + 1];
      if (next === undefined || next === ' ') {
        cut = index;
        break;
      }
    }
  }
  return clipped.slice(0, cut >= 0 ? cut + 1 : clipped.length).join('').trim();
}

/** 服务启动时对账：Agent 已完成就回填 completed，否则标 failed 并退回已扣额度。 */
export async function recoverDeviceUtterances(app: FastifyInstance): Promise<void> {
  const stale = app.db
    .select()
    .from(deviceUtterances)
    .where(eq(deviceUtterances.status, 'processing'))
    .all();

  for (const row of stale) {
    const userMessage = app.db
      .select()
      .from(messages)
      .where(eq(messages.clientMessageId, `dev:${row.id}`))
      .get();
    const assistant = userMessage
      ? app.db
          .select()
          .from(messages)
          .where(eq(messages.userMessageId, userMessage.id))
          .get()
      : undefined;
    const ttsFile = path.join(app.config.ttsPath, `${row.id}.mp3`);
    const hasAudio = existsSync(ttsFile);

    await cleanupAudio(row.audioPath);

    if (assistant) {
      app.db
        .update(deviceUtterances)
        .set({
          status: 'completed',
          replyText: capSpeechText(assistant.content, app.config.ttsMaxChars),
          replyAudioPath: hasAudio ? ttsFile : null,
          audioPath: null,
          errorCode: null,
          errorMessage: null,
          updatedAt: app.now().toISOString(),
        })
        .where(eq(deviceUtterances.id, row.id))
        .run();
      continue;
    }

    if (userMessage) {
      // Agent 之前就中断了：这一条已经扣过额度，清扫时退回。
      const day = dayInTimeZone(new Date(userMessage.createdAt), app.config.quotaTimezone);
      refundQuota(app.db, row.userId, day, app.now());
    }
    app.db
      .update(deviceUtterances)
      .set({
        status: 'failed',
        audioPath: null,
        replyAudioPath: null,
        errorCode: 'INTERRUPTED',
        errorMessage: 'server restarted during processing',
        updatedAt: app.now().toISOString(),
      })
      .where(eq(deviceUtterances.id, row.id))
      .run();
  }

  await sweepTtsFiles(app);
}

async function sweepTtsFiles(app: FastifyInstance): Promise<void> {
  const cutoff = app.now().getTime() - app.config.ttsRetentionHours * 60 * 60 * 1000;
  let entries: string[];
  try {
    entries = await readdir(app.config.ttsPath);
  } catch {
    return;
  }
  for (const name of entries) {
    const file = path.join(app.config.ttsPath, name);
    try {
      const info = await stat(file);
      if (info.mtimeMs < cutoff) await rm(file, { force: true });
    } catch {
      // 已被并发删除的文件不需要再处理。
    }
  }
}
