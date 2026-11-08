import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audioMimeType } from './asr/minimax';
import { isKnownAudio } from './asr/audio';
import { recordings, type RecordingRow } from './db/schema';
import type { DeviceAuth } from './devices';
import {
  AppError,
  invalidInput,
  notFound,
  payloadTooLarge,
  unauthorized,
  unsupportedAudio,
} from './lib/errors';
import { processRecording, toRecordingDto } from './recordings';

export function registerDeviceRecordingRoutes(app: FastifyInstance): void {
  app.post(
    '/api/device/recordings',
    {
      preHandler: app.authenticateDevice,
      bodyLimit: app.config.recordingMaxBytes + 1024 * 1024,
    },
    async (request, reply) => {
      const auth = requireDeviceAuth(request);

      let filename = '';
      let mimeType = 'application/octet-stream';
      let audio: Buffer | undefined;
      let durationMs: number | undefined;
      try {
        for await (const part of request.parts({
          limits: { fileSize: app.config.recordingMaxBytes, files: 1, fields: 4 },
        })) {
          if (part.type === 'file') {
            if (part.fieldname !== 'audio') throw invalidInput('unexpected file field');
            filename = part.filename ?? '';
            mimeType = part.mimetype || mimeType;
            audio = await part.toBuffer();
          } else if (part.fieldname === 'durationMs') {
            durationMs = parseDurationMs(part.value);
          }
        }
      } catch (error) {
        throw mapMultipartError(error, app.config.recordingMaxBytes);
      }

      if (!audio || audio.length === 0) throw invalidInput('audio file is required');
      if (audio.length > app.config.recordingMaxBytes) throw payloadTooLarge();
      if (durationMs !== undefined && durationMs > app.config.recordingMaxSeconds * 1000) {
        throw invalidInput('recording is longer than the limit', {
          maxSeconds: app.config.recordingMaxSeconds,
        });
      }

      const id = randomUUID();
      const extension = path.extname(filename).toLowerCase();
      const audioPath = path.join(app.config.recordingsPath, `${id}${extension || '.bin'}`);
      // 先按扩展名校验格式，避免把不支持的容器写进磁盘。
      if (!isKnownAudio(audioPath)) {
        throw unsupportedAudio(`Unsupported audio format: ${extension || 'unknown'}`);
      }

      await mkdir(app.config.recordingsPath, { recursive: true });
      await writeFile(audioPath, audio);

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
        userId: auth.user.id,
        deviceId: auth.device.id,
        status: 'transcribing',
        mimeType,
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
        { recordingId: row.id, deviceId: row.deviceId, bytes: row.sizeBytes },
        'device recording uploaded',
      );
      void processRecording(app, row.id);

      return reply.code(202).send(toRecordingDto(row));
    },
  );

  app.get(
    '/api/device/recordings/:recordingId',
    { preHandler: app.authenticateDevice },
    async (request) => {
      const auth = requireDeviceAuth(request);
      const { recordingId } = request.params as { recordingId: string };
      return toRecordingDto(getOwnedRecording(app, auth.device.id, recordingId));
    },
  );
}

function getOwnedRecording(app: FastifyInstance, deviceId: string, recordingId: string): RecordingRow {
  const row = app.db
    .select()
    .from(recordings)
    .where(and(eq(recordings.id, recordingId), eq(recordings.deviceId, deviceId)))
    .get();
  if (!row) throw notFound('Recording not found');
  return row;
}

function requireDeviceAuth(request: FastifyRequest): DeviceAuth {
  if (!request.deviceAuth) throw unauthorized('Device token required');
  return request.deviceAuth;
}

function parseDurationMs(value: unknown): number | undefined {
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
