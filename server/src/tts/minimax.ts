import { internal } from '../lib/errors';

export interface SynthesizeSpeechOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  voice: string;
  text: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface MiniMaxTtsResponse {
  data?: { audio?: string };
  base_resp?: { status_code?: number; status_msg?: string };
}

/**
 * MiniMax T2A：请求体里的 `output_format: hex` 决定 audio 字段是十六进制字符串。
 * 调用方把失败当成非致命：结果已经写进 App，只是设备端没有音频可播。
 */
export async function synthesizeSpeech(options: SynthesizeSpeechOptions): Promise<Buffer> {
  const url = `${options.baseUrl.replace(/\/+$/, '')}/v1/t2a_v2`;
  const response = await (options.fetchImpl ?? fetch)(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      text: options.text,
      voice_setting: { voice_id: options.voice },
      audio_setting: { format: 'mp3', sample_rate: 24_000, bitrate: 64_000, channel: 1 },
      output_format: 'hex',
      stream: false,
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw internal('Speech synthesis request timed out');
    }
    throw internal('Speech synthesis request failed');
  });

  const body = await response.text();
  if (!response.ok) {
    throw internal(`Speech synthesis failed with status ${response.status}`);
  }

  let parsed: MiniMaxTtsResponse;
  try {
    parsed = JSON.parse(body) as MiniMaxTtsResponse;
  } catch {
    throw internal('Speech synthesis response was not JSON');
  }

  const status = parsed.base_resp?.status_code;
  if (typeof status === 'number' && status !== 0) {
    throw internal('Speech synthesis was rejected');
  }

  const hex = parsed.data?.audio;
  if (
    typeof hex !== 'string' ||
    hex.length === 0 ||
    hex.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(hex)
  ) {
    throw internal('Speech synthesis returned invalid audio');
  }
  const audio = Buffer.from(hex, 'hex');
  if (audio.length === 0) {
    throw internal('Speech synthesis returned empty audio');
  }
  return audio;
}
