import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { audioMimeType, transcribeAudio } from '../src/asr/minimax';
import { formatTranscript, MAX_TRANSCRIPT_LENGTH } from '../src/asr/transcript';
import { AppError } from '../src/lib/errors';

let dir: string | undefined;

function audioFile(name = 'meeting.m4a'): string {
  dir = mkdtempSync(path.join(tmpdir(), 'nota-asr-'));
  const filePath = path.join(dir, name);
  writeFileSync(filePath, Buffer.from('fake-audio'));
  return filePath;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('ASR · 音频格式校验', () => {
  it('接受 MiniMax 支持的容器', () => {
    expect(audioMimeType('/tmp/a.m4a')).toBe('audio/mp4');
    expect(audioMimeType('/tmp/a.ogg')).toBe('audio/ogg');
    expect(audioMimeType('/tmp/a.WAV')).toBe('audio/wav');
  });

  it('拒绝浏览器默认的 webm', () => {
    expect(() => audioMimeType('/tmp/a.webm')).toThrowError(AppError);
  });
});

describe('ASR · MiniMax 请求与响应', () => {
  it('按 verbose_json 调用并解析说话人', async () => {
    const filePath = audioFile();
    let seenUrl = '';
    let seenAuth = '';
    let seenModel = '';
    let seenFormat = '';
    let seenFile: unknown;

    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenAuth = (init.headers as Record<string, string>).authorization;
      const form = init.body as FormData;
      seenModel = String(form.get('model'));
      seenFormat = String(form.get('response_format'));
      seenFile = form.get('file');
      return new Response(
        JSON.stringify({
          text: '预算最多两万。',
          duration: 12.7,
          n_speakers: 2,
          segments: [
            { start: 0.1, end: 4.2, speaker: 'S1', text: '预算最多两万。' },
            { start: 5, end: 9, speaker: 'S2', text: '那我改方案。' },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const transcript = await transcribeAudio({
      apiKey: 'test-key',
      baseUrl: 'https://api.minimax.cn/',
      model: 'asr-1.0',
      filePath,
      fetchImpl,
    });

    expect(seenUrl).toBe('https://api.minimax.cn/v1/speech_to_text');
    expect(seenAuth).toBe('Bearer test-key');
    expect(seenModel).toBe('asr-1.0');
    expect(seenFormat).toBe('verbose_json');
    expect(seenFile).toBeInstanceOf(Blob);
    expect(transcript).toMatchObject({ text: '预算最多两万。', speakerCount: 2, durationSec: 12.7 });
    expect(transcript.segments).toHaveLength(2);
    expect(transcript.segments[1]).toMatchObject({ speaker: 'S2', text: '那我改方案。' });
  });

  it('把上游失败映射为 TRANSCRIPTION_FAILED 并带状态码', async () => {
    const filePath = audioFile();
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: 'insufficient balance' } }), {
        status: 402,
      })) as unknown as typeof fetch;

    await expect(
      transcribeAudio({
        apiKey: 'k',
        baseUrl: 'https://api.minimax.cn',
        model: 'asr-1.0',
        filePath,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: 'TRANSCRIPTION_FAILED',
      details: { upstreamStatus: 402 },
    });
  });

  it('空转写视为失败，不生成空会议', async () => {
    const filePath = audioFile();
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ text: '   ', duration: 3 }), {
        status: 200,
      })) as unknown as typeof fetch;

    await expect(
      transcribeAudio({
        apiKey: 'k',
        baseUrl: 'https://api.minimax.cn',
        model: 'asr-1.0',
        filePath,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'TRANSCRIPTION_FAILED' });
  });
});

describe('转写全文格式化', () => {
  it('相邻同说话人的句子合并成一行', () => {
    const text = formatTranscript({
      text: '',
      durationSec: 10,
      speakerCount: 2,
      segments: [
        { start: 0, end: 2, speaker: 'S1', text: '人都到齐了吧？' },
        { start: 2, end: 4, speaker: 'S1', text: '开始。' },
        { start: 4, end: 6, speaker: 'S2', text: '报价改过了。' },
      ],
    });
    expect(text).toBe('说话人 1：人都到齐了吧？开始。\n说话人 2：报价改过了。');
  });

  it('只有一个说话人时不加编号', () => {
    const text = formatTranscript({
      text: '',
      durationSec: 5,
      segments: [{ start: 0, end: 5, speaker: 'S1', text: '记一下明天买牛奶。' }],
    });
    expect(text).toBe('记一下明天买牛奶。');
  });

  it('没有分段时退回原始文本', () => {
    const text = formatTranscript({ text: '整段文字', durationSec: 5, segments: [] });
    expect(text).toBe('整段文字');
  });

  it('超过消息上限时截断', () => {
    const text = formatTranscript({
      text: '字'.repeat(MAX_TRANSCRIPT_LENGTH + 50),
      durationSec: 5,
      segments: [],
    });
    expect(text.length).toBe(MAX_TRANSCRIPT_LENGTH);
    expect(text.endsWith('…')).toBe(true);
  });
});
