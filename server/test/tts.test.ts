import { describe, expect, it } from 'vitest';
import { synthesizeSpeech } from '../src/tts/minimax';

const BASE = {
  apiKey: 'test-minimax-key',
  baseUrl: 'https://api.minimax.cn',
  model: 'speech-2.8-hd',
  voice: 'female-yujie',
  text: '好的',
};

function json(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe('场景：TTS 客户端', () => {
  it('把 hex 解码成音频字节', async () => {
    const audio = await synthesizeSpeech({
      ...BASE,
      fetchImpl: json({ data: { audio: '494433' }, base_resp: { status_code: 0 } }),
    });
    expect(audio.toString()).toBe('ID3');
  });

  it('非法 hex、非 JSON、上游错误和 HTTP 错误都抛错', async () => {
    await expect(
      synthesizeSpeech({
        ...BASE,
        fetchImpl: json({ data: { audio: 'zz' }, base_resp: { status_code: 0 } }),
      }),
    ).rejects.toThrow();

    await expect(
      synthesizeSpeech({
        ...BASE,
        fetchImpl: (async () => new Response('not json', { status: 200 })) as typeof fetch,
      }),
    ).rejects.toThrow();

    await expect(
      synthesizeSpeech({
        ...BASE,
        fetchImpl: json({ base_resp: { status_code: 1001, status_msg: 'bad' } }),
      }),
    ).rejects.toThrow();

    await expect(synthesizeSpeech({ ...BASE, fetchImpl: json({}, 500) })).rejects.toThrow();
  });
});
