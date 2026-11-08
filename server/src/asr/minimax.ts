import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, transcriptionFailed, unsupportedAudio } from '../lib/errors';

/** MiniMax 单次转写的音频格式白名单（见 docs/guides/speech-to-text）。 */
const SUPPORTED_EXTENSIONS = new Map<string, string>([
  ['.wav', 'audio/wav'],
  ['.aiff', 'audio/aiff'],
  ['.aif', 'audio/aiff'],
  ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.aac', 'audio/aac'],
  ['.opus', 'audio/opus'],
  ['.ogg', 'audio/ogg'],
]);

export interface TranscriptSegment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface Transcript {
  text: string;
  durationSec: number;
  speakerCount?: number;
  segments: TranscriptSegment[];
}

export interface TranscribeAudioOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  filePath: string;
  /** 上游卡住时不能把 recording 永远留在 transcribing。 */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface MiniMaxSegment {
  start?: number;
  end?: number;
  speaker?: string;
  text?: string;
}

interface MiniMaxResponse {
  text?: string;
  duration?: number;
  n_speakers?: number;
  segments?: MiniMaxSegment[];
}

export function audioMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = SUPPORTED_EXTENSIONS.get(extension);
  if (!mimeType) {
    throw unsupportedAudio(`Unsupported audio format: ${extension || 'unknown'}`);
  }
  return mimeType;
}

export async function transcribeAudio(options: TranscribeAudioOptions): Promise<Transcript> {
  const mimeType = audioMimeType(options.filePath);
  const audio = await readFile(options.filePath);
  const form = new FormData();
  form.append('model', options.model);
  form.append('response_format', 'verbose_json');
  form.append('file', new Blob([audio], { type: mimeType }), path.basename(options.filePath));

  const url = `${options.baseUrl.replace(/\/+$/, '')}/v1/speech_to_text`;
  const response = await (options.fetchImpl ?? fetch)(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${options.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw transcriptionFailed('Transcription request timed out', {
        timeoutMs: options.timeoutMs ?? 180_000,
      });
    }
    throw transcriptionFailed('Transcription request failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
  });

  const body = await response.text();
  if (!response.ok) {
    throw upstreamError(response.status, body);
  }

  let parsed: MiniMaxResponse;
  try {
    parsed = JSON.parse(body) as MiniMaxResponse;
  } catch {
    throw transcriptionFailed('Transcription response was not JSON', {
      upstreamStatus: response.status,
    });
  }

  const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  if (!text) {
    throw transcriptionFailed('Transcription returned empty text');
  }

  return {
    text,
    durationSec: typeof parsed.duration === 'number' ? parsed.duration : 0,
    speakerCount:
      typeof parsed.n_speakers === 'number' && parsed.n_speakers > 0
        ? parsed.n_speakers
        : undefined,
    segments: normalizeSegments(parsed.segments),
  };
}

function normalizeSegments(raw: MiniMaxSegment[] | undefined): TranscriptSegment[] {
  if (!Array.isArray(raw)) return [];
  const segments: TranscriptSegment[] = [];
  for (const item of raw) {
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) continue;
    segments.push({
      start: typeof item.start === 'number' ? item.start : 0,
      end: typeof item.end === 'number' ? item.end : 0,
      speaker: typeof item.speaker === 'string' && item.speaker.trim() ? item.speaker.trim() : 'S1',
      text,
    });
  }
  return segments;
}

function upstreamError(status: number, body: string): AppError {
  const detail = extractUpstreamMessage(body);
  const message =
    status === 402
      ? 'Transcription provider has insufficient balance'
      : status === 401
        ? 'Transcription provider rejected the API key'
        : status === 429
          ? 'Transcription provider rate limited the request'
          : `Transcription provider returned ${status}`;
  return transcriptionFailed(message, {
    upstreamStatus: status,
    ...(detail ? { upstreamMessage: detail } : {}),
  });
}

function extractUpstreamMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const value = parsed.error?.message ?? parsed.message;
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200);
  } catch {
    // 上游可能返回空体或 HTML，忽略解析失败。
  }
  return undefined;
}
