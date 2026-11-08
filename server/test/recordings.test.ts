import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { recordings, users } from '../src/db/schema';
import { recoverRecordings } from '../src/recordings';
import {
  call,
  createTestApp,
  DEFAULT_TRANSCRIPT,
  finishOnly,
  login,
  sendMessage,
  type TestContext,
} from './helpers';

const BOUNDARY = '----notaTestBoundary';

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
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: audio/mp4\r\n\r\n`,
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
  filename = 'meeting.m4a',
  bytes: Buffer = Buffer.from('fake-audio-bytes'),
  fields: Record<string, string> = { durationMs: '12000' },
) {
  const { payload, headers } = multipart(filename, bytes, fields);
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/recordings',
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
      url: `/api/recordings/${id}`,
      token,
    });
    if (response.body.status !== 'transcribing') return response.body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('recording did not finish in time');
}

describe('场景：会议录音 → 纪要', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx.close();
  });

  it('转写成功后创建会议，首条消息是带说话人的全文，并且只扣一次额度', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    ctx.faux.setResponses([
      finishOnly({
        title: '产品周会：报价与联调排期',
        summary: '报价下调两千，周四给原型。',
        reply: '已整理：报价下调两千，李工周四前给原型。',
      }),
    ]);

    const created = await upload(ctx, auth.token);
    expect(created.status).toBe(202);
    expect(created.body.status).toBe('transcribing');

    const done = await waitForRecording(ctx, auth.token, created.body.id);
    expect(done.status).toBe('completed');
    expect(done.threadId).toEqual(expect.any(String));

    const detail = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${done.threadId}`,
      token: auth.token,
    });
    expect(detail.body.thread.kind).toBe('meeting');
    expect(detail.body.thread.title).toBe('产品周会：报价与联调排期');
    expect(detail.body.messages).toHaveLength(2);
    expect(detail.body.messages[0].role).toBe('user');
    expect(detail.body.messages[0].content).toBe(
      '说话人 1：人都到齐了吧？开始，先说报价这事。\n说话人 2：报价我重新核了一遍，比上次低了两千。',
    );
    expect(detail.body.messages[1].role).toBe('assistant');

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(1);

    // 音频转写成功后立即删除。
    expect(readdirSync(ctx.config.recordingsPath)).toEqual([]);
  });

  it('同一条录音重跑不会建第二场会，也不重复扣额度', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);
    ctx.faux.setResponses([finishOnly({ reply: '已整理' })]);

    const created = await upload(ctx, auth.token);
    const done = await waitForRecording(ctx, auth.token, created.body.id);

    const threadsBefore = await call(ctx, { method: 'GET', url: '/api/threads', token: auth.token });
    const { processRecording } = await import('../src/recordings');
    await processRecording(ctx.app, created.body.id);

    const threadsAfter = await call(ctx, { method: 'GET', url: '/api/threads', token: auth.token });
    expect(threadsAfter.body.threads).toHaveLength(threadsBefore.body.threads.length);

    const detail = await call(ctx, {
      method: 'GET',
      url: `/api/threads/${done.threadId}`,
      token: auth.token,
    });
    expect(detail.body.messages).toHaveLength(2);

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(1);
  });

  it('转写失败时保留音频，重试后复用同一场会议', async () => {
    let attempts = 0;
    ctx = await createTestApp({
      transcribe: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('provider exploded');
        return DEFAULT_TRANSCRIPT;
      },
    });
    const auth = await login(ctx);
    ctx.faux.setResponses([finishOnly({ reply: '已整理' })]);

    const created = await upload(ctx, auth.token);
    const failed = await waitForRecording(ctx, auth.token, created.body.id);
    expect(failed.status).toBe('failed');
    expect(failed.errorCode).toBe('TRANSCRIPTION_FAILED');

    const retried = await call(ctx, {
      method: 'POST',
      url: `/api/recordings/${created.body.id}/retry`,
      token: auth.token,
    });
    expect(retried.status).toBe(202);

    const done = await waitForRecording(ctx, auth.token, created.body.id);
    expect(done.status).toBe('completed');

    const usage = await call(ctx, { method: 'GET', url: '/api/usage', token: auth.token });
    expect(usage.body.used).toBe(1);
  });

  it('额度用完时任务失败并保留音频', async () => {
    ctx = await createTestApp({ dailyLimit: 1 });
    const auth = await login(ctx);
    ctx.faux.setResponses([finishOnly({ reply: '已记录' }), finishOnly({ reply: '已整理' })]);

    const first = await sendMessage(ctx, auth.token, '记一下，明天买牛奶');
    expect(first.status).toBe(200);

    const created = await upload(ctx, auth.token);
    const failed = await waitForRecording(ctx, auth.token, created.body.id);
    expect(failed.status).toBe('failed');
    expect(failed.errorCode).toBe('QUOTA_EXCEEDED');
    // 失败时不能把空会议留在时间线里
    expect(failed.threadId).toBeUndefined();
    const threads = await call(ctx, { method: 'GET', url: '/api/threads', token: auth.token });
    expect(
      threads.body.threads.filter((thread: { kind: string }) => thread.kind === 'meeting'),
    ).toHaveLength(0);
  });

  it('不支持的音频格式返回 415', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);

    const response = await upload(ctx, auth.token, 'meeting.webm');
    expect(response.status).toBe(415);
    expect(response.body.code).toBe('INVALID_INPUT');
  });

  it('超过时长上限返回 400', async () => {
    ctx = await createTestApp();
    const auth = await login(ctx);

    const response = await upload(ctx, auth.token, 'meeting.m4a', Buffer.from('audio'), {
      durationMs: String(481 * 1000),
    });
    expect(response.status).toBe(400);
  });

  it('启动清扫把卡住的转写标记为 interrupted', async () => {
    ctx = await createTestApp();
    await login(ctx);
    const now = ctx.currentNow.toISOString();
    const recordingId = randomUUID();
    const owner = ctx.app.db.select().from(users).get();
    if (!owner) throw new Error('user missing');

    ctx.app.db
      .insert(recordings)
      .values({
        id: recordingId,
        userId: owner.id,
        status: 'transcribing',
        mimeType: 'audio/mp4',
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

    await recoverRecordings(ctx.app);

    const row = ctx.app.db
      .select()
      .from(recordings)
      .all()
      .find((item) => item.id === recordingId);
    expect(row?.status).toBe('failed');
    expect(row?.errorCode).toBe('INTERRUPTED');
  });
});
