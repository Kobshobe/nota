import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { Transcript } from '../src/asr/minimax';
import { devices, deviceUtterances } from '../src/db/schema';
import { capSpeechText, recoverDeviceUtterances } from '../src/device-utterances';
import {
  call,
  createDevice,
  createTestApp,
  finishOnly,
  login,
  textOnly,
  type TestContext,
} from './helpers';

const BOUNDARY = '----notaDeviceTest';
const DEVICE_TRANSCRIPT: Transcript = {
  text: '提醒我明天下午三点和张总开会。',
  durationSec: 2.6,
  segments: [],
};

function multipart(
  filename: string,
  bytes: Buffer,
  fields: Record<string, string> = {},
): { payload: Buffer; headers: Record<string, string> } {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`,
    ),
  );
  parts.push(bytes);
  parts.push(Buffer.from(`\r\n--${BOUNDARY}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

async function upload(
  ctx: TestContext,
  token: string,
  options: { filename?: string; bytes?: Buffer; fields?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const { payload, headers } = multipart(
    options.filename ?? 'utterance.mp3',
    options.bytes ?? Buffer.from('fake-mp3-bytes'),
    options.fields ?? { durationMs: '2600' },
  );
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/device/utterances',
    headers: { ...headers, authorization: `Bearer ${token}` },
    payload,
  });
  return {
    status: response.statusCode,
    body: response.body.length > 0 ? JSON.parse(response.body) : undefined,
  };
}

async function waitFor(
  ctx: TestContext,
  token: string,
  id: string,
): Promise<{ status: string; replyText?: string; replyAudioUrl?: string; errorCode?: string }> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await call(ctx, {
      method: 'GET',
      url: `/api/device/utterances/${id}`,
      token,
    });
    if (response.body.status !== 'processing') return response.body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('device utterance did not finish in time');
}

describe('场景：设备语音 → 日常 thread → 语音回复', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx.close();
  });

  it('上传后落进日常 thread，扣一次额度，并生成可下载的 TTS 回复', async () => {
    ctx = await createTestApp({ transcript: DEVICE_TRANSCRIPT });
    const auth = await login(ctx);
    const device = await createDevice(ctx);
    ctx.faux.setResponses([finishOnly({ reply: '好的，明天下午三点提醒你和张总开会。' })]);

    const created = await upload(ctx, device.token);
    expect(created.status).toBe(202);
    expect(created.body.status).toBe('processing');
    expect(created.body.id).toEqual(expect.any(String));

    const done = await waitFor(ctx, device.token, created.body.id);
    expect(done.status).toBe('completed');
    expect(done.replyText).toBe('好的，明天下午三点提醒你和张总开会。');
    expect(done.replyAudioUrl).toBe(`/api/device/utterances/${created.body.id}/reply-audio`);

    const threads = await call(ctx, { method: 'GET', url: '/api/threads', token: auth.token });
    const daily = threads.body.threads.find((thread: { kind: string }) => thread.kind === 'daily');
    const detail = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${daily.id}`,
      token: auth.token,
    });
    expect(detail.body.messages).toHaveLength(2);
    expect(detail.body.messages[0].content).toBe(DEVICE_TRANSCRIPT.text);
    expect(detail.body.messages[1].content).toBe('好的，明天下午三点提醒你和张总开会。');

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(1);

    const audio = await ctx.app.inject({
      method: 'GET',
      url: done.replyAudioUrl as string,
      headers: { authorization: `Bearer ${device.token}` },
    });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers['content-type']).toContain('audio/mpeg');
    expect(audio.rawPayload.toString()).toBe('fake-mp3-bytes');

    expect(readdirSync(ctx.config.deviceUploadsPath)).toEqual([]);
    expect(readdirSync(ctx.config.ttsPath)).toEqual([`${created.body.id}.mp3`]);

    // 音频过期/被删后，状态不再暴露一个 404 的 URL。
    rmSync(path.join(ctx.config.ttsPath, `${created.body.id}.mp3`));
    const afterExpiry = await call(ctx, {
      method: 'GET',
      url: `/api/device/utterances/${created.body.id}`,
      token: device.token,
    });
    expect(afterExpiry.body.replyAudioUrl).toBeUndefined();
    const expired = await ctx.app.inject({
      method: 'GET',
      url: done.replyAudioUrl as string,
      headers: { authorization: `Bearer ${device.token}` },
    });
    expect(expired.statusCode).toBe(404);
  });

  it('缺 token、错 token 和撤销后的 token 都返回 401', async () => {
    ctx = await createTestApp({ transcript: DEVICE_TRANSCRIPT });
    const auth = await login(ctx);
    const device = await createDevice(ctx);

    const noHeader = await ctx.app.inject({
      method: 'GET',
      url: `/api/device/utterances/${randomUUID()}`,
    });
    expect(noHeader.statusCode).toBe(401);

    const bad = await call(ctx, {
      method: 'GET',
      url: `/api/device/utterances/${randomUUID()}`,
      token: 'dev_not-a-real-token',
    });
    expect(bad.status).toBe(401);

    // 设备 token 不能当 JWT，JWT 也不能当设备 token。
    const jwtAsDevice = await upload(ctx, auth.token);
    expect(jwtAsDevice.status).toBe(401);
    const deviceAsJwt = await call(ctx, { method: 'GET', url: '/api/threads', token: device.token });
    expect(deviceAsJwt.status).toBe(401);

    ctx.app.db
      .update(devices)
      .set({ revokedAt: ctx.currentNow.toISOString() })
      .where(eq(devices.id, device.id))
      .run();
    const revoked = await upload(ctx, device.token);
    expect(revoked.status).toBe(401);
  });

  it('另一用户的设备同样看不到这条 utterance', async () => {
    ctx = await createTestApp({ transcript: DEVICE_TRANSCRIPT });
    await login(ctx);
    const ownerDevice = await createDevice(ctx, 'user@example.com', '所有者设备');
    await login(ctx, 'other@example.com');
    const otherDevice = await createDevice(ctx, 'other@example.com', '别人的设备');
    ctx.faux.setResponses([finishOnly({ reply: '好的' })]);

    const created = await upload(ctx, ownerDevice.token);
    await waitFor(ctx, ownerDevice.token, created.body.id);

    const status = await call(ctx, {
      method: 'GET',
      url: `/api/device/utterances/${created.body.id}`,
      token: otherDevice.token,
    });
    expect(status.status).toBe(404);
  });

  it('设备看不到另一台设备的 utterance 或回复音频', async () => {
    ctx = await createTestApp({ transcript: DEVICE_TRANSCRIPT });
    await login(ctx);
    const deviceA = await createDevice(ctx, 'user@example.com', '设备 A');
    const deviceB = await createDevice(ctx, 'user@example.com', '设备 B');
    ctx.faux.setResponses([finishOnly({ reply: '好的' })]);

    const created = await upload(ctx, deviceA.token);
    const done = await waitFor(ctx, deviceA.token, created.body.id);

    const status = await call(ctx, {
      method: 'GET',
      url: `/api/device/utterances/${created.body.id}`,
      token: deviceB.token,
    });
    expect(status.status).toBe(404);

    const audio = await ctx.app.inject({
      method: 'GET',
      url: done.replyAudioUrl as string,
      headers: { authorization: `Bearer ${deviceB.token}` },
    });
    expect(audio.statusCode).toBe(404);
  });

  it('额度用完时第二条失败，额度仍是一次', async () => {
    ctx = await createTestApp({ transcript: DEVICE_TRANSCRIPT, dailyLimit: 1 });
    const auth = await login(ctx);
    const device = await createDevice(ctx);
    ctx.faux.setResponses([finishOnly({ reply: '第一条' }), finishOnly({ reply: '第二条' })]);

    const first = await upload(ctx, device.token);
    expect((await waitFor(ctx, device.token, first.body.id)).status).toBe('completed');

    const second = await upload(ctx, device.token);
    const failed = await waitFor(ctx, device.token, second.body.id);
    expect(failed.status).toBe('failed');
    expect(failed.errorCode).toBe('QUOTA_EXCEEDED');

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(1);
    expect(readdirSync(ctx.config.deviceUploadsPath)).toEqual([]);
  });

  it('转写失败时不写消息、不扣额度', async () => {
    ctx = await createTestApp({ transcript: null });
    const auth = await login(ctx);
    const device = await createDevice(ctx);

    const created = await upload(ctx, device.token);
    const done = await waitFor(ctx, device.token, created.body.id);
    expect(done.status).toBe('failed');
    expect(done.errorCode).toBe('TRANSCRIPTION_FAILED');

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(0);
    expect(readdirSync(ctx.config.deviceUploadsPath)).toEqual([]);
  });

  it('TTS 失败仍算完成，只少一段音频', async () => {
    ctx = await createTestApp({
      transcript: DEVICE_TRANSCRIPT,
      synthesizeSpeech: async () => {
        throw new Error('tts is down');
      },
    });
    const auth = await login(ctx);
    const device = await createDevice(ctx);
    ctx.faux.setResponses([finishOnly({ reply: '好的，明天下午三点提醒你。' })]);

    const created = await upload(ctx, device.token);
    const done = await waitFor(ctx, device.token, created.body.id);
    expect(done.status).toBe('completed');
    expect(done.replyText).toBe('好的，明天下午三点提醒你。');
    expect(done.replyAudioUrl).toBeUndefined();

    const audio = await ctx.app.inject({
      method: 'GET',
      url: `/api/device/utterances/${created.body.id}/reply-audio`,
      headers: { authorization: `Bearer ${device.token}` },
    });
    expect(audio.statusCode).toBe(404);

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(1);
  });

  it('Agent 失败时标 AGENT_FAILED 且退回额度', async () => {
    ctx = await createTestApp({ transcript: DEVICE_TRANSCRIPT });
    const auth = await login(ctx);
    const device = await createDevice(ctx);
    ctx.faux.setResponses([textOnly('不会 finish')]);

    const created = await upload(ctx, device.token);
    const done = await waitFor(ctx, device.token, created.body.id);
    expect(done.status).toBe('failed');
    expect(done.errorCode).toBe('AGENT_FAILED');

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(0);
  });

  it('转写时长超过上限时失败，不进入 Agent', async () => {
    ctx = await createTestApp({ transcript: { ...DEVICE_TRANSCRIPT, durationSec: 61 } });
    const auth = await login(ctx);
    const device = await createDevice(ctx);

    const created = await upload(ctx, device.token);
    const done = await waitFor(ctx, device.token, created.body.id);
    expect(done.status).toBe('failed');
    expect(done.errorCode).toBe('TRANSCRIPTION_FAILED');

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(0);
  });

  it('拒绝不支持的格式、超长和超大音频', async () => {
    ctx = await createTestApp({ transcript: DEVICE_TRANSCRIPT, deviceMaxBytes: 1024 });
    await login(ctx);
    const device = await createDevice(ctx);

    const badFormat = await upload(ctx, device.token, { filename: 'utterance.txt' });
    expect(badFormat.status).toBe(415);

    const tooLong = await upload(ctx, device.token, { fields: { durationMs: '61000' } });
    expect(tooLong.status).toBe(400);

    const tooBig = await upload(ctx, device.token, { bytes: Buffer.alloc(2048) });
    expect(tooBig.status).toBe(413);

    const missing = await ctx.app.inject({
      method: 'POST',
      url: '/api/device/utterances',
      headers: {
        authorization: `Bearer ${device.token}`,
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: Buffer.from(`--${BOUNDARY}--\r\n`),
    });
    expect(missing.statusCode).toBe(400);
  });

  it('启动清扫把仍在 processing 的记录标成 INTERRUPTED', async () => {
    ctx = await createTestApp({ transcript: DEVICE_TRANSCRIPT });
    await login(ctx);
    const device = await createDevice(ctx);

    const id = randomUUID();
    const audioPath = path.join(ctx.config.deviceUploadsPath, `${id}.mp3`);
    mkdirSync(ctx.config.deviceUploadsPath, { recursive: true });
    writeFileSync(audioPath, 'stale');
    ctx.app.db
      .insert(deviceUtterances)
      .values({
        id,
        deviceId: device.id,
        userId: device.userId,
        status: 'processing',
        mimeType: 'audio/mpeg',
        sizeBytes: 5,
        durationMs: null,
        audioPath,
        transcriptJson: null,
        replyText: null,
        replyAudioPath: null,
        errorCode: null,
        errorMessage: null,
        createdAt: ctx.currentNow.toISOString(),
        updatedAt: ctx.currentNow.toISOString(),
      })
      .run();

    await recoverDeviceUtterances(ctx.app);

    const row = ctx.app.db
      .select()
      .from(deviceUtterances)
      .where(eq(deviceUtterances.id, id))
      .get();
    expect(row?.status).toBe('failed');
    expect(row?.errorCode).toBe('INTERRUPTED');
    expect(existsSync(audioPath)).toBe(false);
  });

  it('启动清扫：Agent 已完成时回填 completed，不标失败', async () => {
    ctx = await createTestApp({ transcript: DEVICE_TRANSCRIPT });
    await login(ctx);
    const device = await createDevice(ctx);
    ctx.faux.setResponses([finishOnly({ reply: '已设置提醒。' })]);

    const created = await upload(ctx, device.token);
    expect((await waitFor(ctx, device.token, created.body.id)).status).toBe('completed');

    // 模拟「消息已提交、状态还没更新」的崩溃窗口。
    ctx.app.db
      .update(deviceUtterances)
      .set({
        status: 'processing',
        replyAudioPath: null,
        audioPath: path.join(ctx.config.deviceUploadsPath, 'stale.mp3'),
      })
      .where(eq(deviceUtterances.id, created.body.id))
      .run();

    await recoverDeviceUtterances(ctx.app);

    const row = ctx.app.db
      .select()
      .from(deviceUtterances)
      .where(eq(deviceUtterances.id, created.body.id))
      .get();
    expect(row?.status).toBe('completed');
    expect(row?.replyText).toBe('已设置提醒。');

    const status = await call(ctx, {
      method: 'GET',
      url: `/api/device/utterances/${created.body.id}`,
      token: device.token,
    });
    expect(status.body.replyAudioUrl).toBe(
      `/api/device/utterances/${created.body.id}/reply-audio`,
    );
  });

  it('口语回复超长时按句末标点截断', () => {
    expect(capSpeechText('第一句。第二句。第三句。', 6)).toBe('第一句。');
    expect(capSpeechText('  多  空格  ', 200)).toBe('多 空格');
    expect(capSpeechText('价格 3.5 折现在买', 7)).toBe('价格 3.5');
  });
});
