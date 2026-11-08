import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { recordings } from '../src/db/schema';
import {
  call,
  createDevice,
  createTestApp,
  DEFAULT_TRANSCRIPT,
  finishOnly,
  login,
  sendMessage,
  type TestContext,
} from './helpers';

const BOUNDARY = '----notaDeviceBoundary';

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
  filename = 'meeting.mp3',
  bytes: Buffer = Buffer.from('fake-device-audio'),
  fields: Record<string, string> = { durationMs: '40000' },
) {
  const { payload, headers } = multipart(filename, bytes, fields);
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/device/recordings',
    headers: { ...headers, authorization: `Bearer ${token}` },
    payload,
  });
  return {
    status: response.statusCode,
    body: response.body.length > 0 ? JSON.parse(response.body) : undefined,
  };
}

async function waitForRecording(
  ctx: TestContext,
  token: string,
  id: string,
): Promise<{ status: string; threadId?: string; errorCode?: string }> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await call(ctx, {
      method: 'GET',
      url: `/api/device/recordings/${id}`,
      token,
    });
    if (response.body.status !== 'transcribing') return response.body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('device recording did not finish in time');
}

describe('场景：设备会议录音 → 纪要', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx.close();
  });

  it('转写成功后创建会议，纪要进入主对话时间线且只扣一次额度', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    const device = await createDevice(ctx, auth.user.email);
    ctx.faux.setResponses([
      finishOnly({
        title: '产品周会：报价与联调排期',
        summary: '报价下调两千，周四给原型。',
        reply: '已整理：报价下调两千，李工周四前给原型。',
      }),
    ]);

    const created = await upload(ctx, device.token);
    expect(created.status).toBe(202);
    expect(created.body.status).toBe('transcribing');

    const done = await waitForRecording(ctx, device.token, created.body.id);
    expect(done.status).toBe('completed');
    expect(done.threadId).toEqual(expect.any(String));

    const row = ctx.app.db
      .select()
      .from(recordings)
      .all()
      .find((item) => item.id === created.body.id);
    expect(row?.deviceId).toBe(device.id);

    const detail = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${done.threadId}`,
      token: auth.token,
    });
    expect(detail.body.thread.kind).toBe('meeting');
    expect(detail.body.thread.title).toBe('产品周会：报价与联调排期');
    expect(detail.body.messages).toHaveLength(2);
    expect(detail.body.messages[0].content).toBe(
      '说话人 1：人都到齐了吧？开始，先说报价这事。\n说话人 2：报价我重新核了一遍，比上次低了两千。',
    );

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(1);
    expect(readdirSync(ctx.config.recordingsPath)).toEqual([]);
  });

  it('设备读不到别的设备创建的录音', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    const first = await createDevice(ctx, auth.user.email, '设备 A');
    const second = await createDevice(ctx, auth.user.email, '设备 B');
    ctx.faux.setResponses([finishOnly({ reply: '已整理' })]);

    const created = await upload(ctx, first.token);
    const done = await waitForRecording(ctx, first.token, created.body.id);
    expect(done.status).toBe('completed');

    const response = await call(ctx, {
      method: 'GET',
      url: `/api/device/recordings/${created.body.id}`,
      token: second.token,
    });
    expect(response.status).toBe(404);
  });

  it('没有设备 token 返回 401', async () => {
    ctx = await createTestApp();
    const response = await upload(ctx, '');
    expect(response.status).toBe(401);
  });

  it('不支持的音频格式返回 415', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    const device = await createDevice(ctx, auth.user.email);

    const response = await upload(ctx, device.token, 'meeting.txt');
    expect(response.status).toBe(415);
  });

  it('超过时长上限返回 400', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    const device = await createDevice(ctx, auth.user.email);

    const response = await upload(ctx, device.token, 'meeting.mp3', Buffer.from('audio'), {
      durationMs: String(481 * 1000),
    });
    expect(response.status).toBe(400);
  });

  it('超过大小上限返回 413', async () => {
    ctx = await createTestApp({ recordingMaxBytes: 64 });
    const auth = await login(ctx);
    const device = await createDevice(ctx, auth.user.email);

    const response = await upload(ctx, device.token, 'meeting.mp3', Buffer.alloc(128, 1));
    expect(response.status).toBe(413);
  });

  it('转写失败时不扣额度，音频保留', async () => {
    ctx = await createTestApp({ transcript: null });
    const auth = await login(ctx);
    const device = await createDevice(ctx, auth.user.email);

    const created = await upload(ctx, device.token);
    expect(created.status).toBe(202);

    const failed = await waitForRecording(ctx, device.token, created.body.id);
    expect(failed.status).toBe('failed');
    expect(failed.errorCode).toBe('TRANSCRIPTION_FAILED');

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(0);
    expect(readdirSync(ctx.config.recordingsPath)).not.toEqual([]);
  });

  it('额度用完时失败，时间线里不出现空会议', async () => {
    ctx = await createTestApp({ dailyLimit: 1 });
    const auth = await login(ctx);
    const device = await createDevice(ctx, auth.user.email);
    ctx.faux.setResponses([finishOnly({ reply: '已记录' })]);

    const first = await sendMessage(ctx, auth.token, '记一下，明天买牛奶');
    expect(first.status).toBe(200);

    const created = await upload(ctx, device.token);
    const failed = await waitForRecording(ctx, device.token, created.body.id);
    expect(failed.status).toBe('failed');
    expect(failed.errorCode).toBe('QUOTA_EXCEEDED');
    expect(failed.threadId).toBeUndefined();

    const threads = await call(ctx, { method: 'GET', url: '/api/threads', token: auth.token });
    expect(
      threads.body.threads.filter((thread: { kind: string }) => thread.kind === 'meeting'),
    ).toHaveLength(0);
  });

  it('启动清扫把设备遗留的转写标记为 interrupted', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    const device = await createDevice(ctx, auth.user.email);
    const now = ctx.currentNow.toISOString();

    ctx.app.db
      .insert(recordings)
      .values({
        id: randomUUID(),
        userId: device.userId,
        deviceId: device.id,
        status: 'transcribing',
        mimeType: 'audio/mpeg',
        sizeBytes: 10,
        durationMs: 1000,
        audioPath: null,
        transcriptJson: null,
        threadId: null,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const { recoverRecordings } = await import('../src/recordings');
    await recoverRecordings(ctx.app);

    const row = ctx.app.db.select().from(recordings).all().find((item) => item.deviceId === device.id);
    expect(row?.status).toBe('failed');
    expect(row?.errorCode).toBe('INTERRUPTED');
  });
});
