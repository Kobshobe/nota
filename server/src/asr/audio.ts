import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { transcriptionFailed, unsupportedAudio } from '../lib/errors';

const run = promisify(execFile);

/** 上游直接接受的容器。 */
const SUPPORTED = new Set(['.wav', '.aiff', '.aif', '.flac', '.m4a', '.mp3', '.aac', '.opus', '.ogg']);

/** 浏览器 MediaRecorder 的默认容器；MiniMax 不收，先转成 m4a。 */
const TRANSCODABLE = new Set(['.webm']);

export function isKnownAudio(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return SUPPORTED.has(extension) || TRANSCODABLE.has(extension);
}

export interface PrepareAudioOptions {
  ffmpegPath: string;
  timeoutMs?: number;
}

/**
 * 返回可以直接交给转写服务的音频路径。
 *
 * 支持的容器原样返回；Web 录出来的 webm 用 ffmpeg 转成 16 kHz 单声道 m4a，
 * 转完删掉原件，避免磁盘里留两份。
 */
export async function prepareAudio(
  filePath: string,
  options: PrepareAudioOptions,
): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();
  if (SUPPORTED.has(extension)) return filePath;
  if (!TRANSCODABLE.has(extension)) {
    throw unsupportedAudio(`Unsupported audio format: ${extension || 'unknown'}`);
  }

  const target = `${filePath.slice(0, -extension.length)}.m4a`;
  try {
    await run(
      options.ffmpegPath,
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        filePath,
        '-vn',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-ar',
        '16000',
        '-ac',
        '1',
        target,
      ],
      { timeout: options.timeoutMs ?? 60_000 },
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') {
      throw unsupportedAudio('Audio transcoding requires ffmpeg on the server', {
        ffmpegPath: options.ffmpegPath,
      });
    }
    throw transcriptionFailed('Audio transcoding failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }

  await rm(filePath, { force: true });
  return target;
}
