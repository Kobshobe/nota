import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assistantWithTools,
  createTestApp,
  finishOnly,
  finishWith,
  login,
  sendMessage,
  type TestContext,
} from './helpers';

describe('场景：日志 · 一次运行打印可读的工具调用', () => {
  let ctx: TestContext;
  let token: string;
  let lines: string[];

  beforeEach(async () => {
    lines = [];
    ctx = await createTestApp({
      logger: { level: 'info', stream: { write: (line: string) => lines.push(line) } },
    });
    token = (await login(ctx)).token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('工具调用的入参和结果都在日志里，且不是 JSON 字符串', async () => {
    // given：模型会创建一条待办再收尾
    ctx.faux.setResponses([
      finishWith([{ name: 'create_item', args: { title: '买牛奶', kind: 'todo' } }], {
        reply: '已记录：明天买牛奶',
      }),
    ]);

    // when：发送消息触发一次 Agent 运行
    const response = await sendMessage(ctx, token, '记一下，明天买牛奶');

    // then：请求成功，日志里能看到工具调用的过程
    expect(response.status).toBe(200);
    const messages = messagesOf(lines);
    expect(messages).toContain('▶ create_item 标题=「买牛奶」 类型=待办');
    expect(messages.some((line) => line.startsWith('✔ create_item 已暂存 new_1'))).toBe(true);
    expect(messages.some((line) => line.startsWith('✔ finish 已暂存结果'))).toBe(true);
    expect(messages.some((line) => line.startsWith('agent 运行结束 2 次工具调用'))).toBe(true);
  });

  it('日志里不出现参数的对象序列化', async () => {
    ctx.faux.setResponses([
      finishWith([{ name: 'create_item', args: { title: '交周报', kind: 'todo' } }], {
        reply: '已记录',
      }),
    ]);

    await sendMessage(ctx, token, '记一下交周报');

    const toolLines = messagesOf(lines).filter(
      (line) => line.startsWith('▶') || line.startsWith('✔') || line.startsWith('✘'),
    );
    expect(toolLines.length).toBeGreaterThan(0);
    for (const line of toolLines) {
      expect(line).not.toContain('":"');
      expect(line).not.toContain('{"');
      expect(line).not.toContain('["');
    }
  });

  it('工具失败时也有开始和结束日志，并带失败原因', async () => {
    // given：模型给提醒漏了 dueAt，工具会抛错
    ctx.faux.setResponses([
      assistantWithTools([{ name: 'create_item', args: { title: '开会', kind: 'reminder' } }]),
      finishOnly({ reply: '好' }),
    ]);

    // when
    const response = await sendMessage(ctx, token, '提醒我开会');

    // then
    expect(response.status).toBe(200);
    const messages = messagesOf(lines);
    expect(messages.some((line) => line.startsWith('▶ create_item'))).toBe(true);
    expect(
      messages.some((line) => line.startsWith('✘ create_item 失败：A reminder requires dueAt')),
    ).toBe(true);
  });

  it('模型报错时日志记录真实原因，且压成一行', async () => {
    // given：供应商返回错误消息
    ctx.faux.setResponses([
      fauxAssistantMessage('', {
        stopReason: 'error',
        errorMessage: 'upstream 502: bad gateway\nraw body',
      }),
    ]);

    // when
    const response = await sendMessage(ctx, token, '随便聊一句');

    // then：请求失败，但日志里有可读原因
    expect(response.status).toBe(500);
    const messages = messagesOf(lines);
    const failure = messages.find((line) => line.startsWith('agent 运行失败：'));
    expect(failure).toContain('upstream 502: bad gateway raw body');
    expect(failure).not.toContain('\n');
  });

  it('供应商错误里带密钥时先打码再写日志', async () => {
    ctx.faux.setResponses([
      fauxAssistantMessage('', {
        stopReason: 'error',
        errorMessage: 'invalid api_key=sk-abcdef1234567890 for request',
      }),
    ]);

    const response = await sendMessage(ctx, token, '再试一次');

    expect(response.status).toBe(500);
    const failure = messagesOf(lines).find((line) => line.startsWith('agent 运行失败：'));
    expect(failure).toContain('[redacted');
    expect(failure).not.toContain('sk-abcdef1234567890');
  });

  it('结构化字段保留工具名、耗时和失败标记，便于机器读取', async () => {
    ctx.faux.setResponses([
      finishWith([{ name: 'create_item', args: { title: '写总结', kind: 'todo' } }], {
        reply: '好的',
      }),
    ]);

    await sendMessage(ctx, token, '记一下写总结');

    const entry = entriesOf(lines).find((item) => item.tool === 'create_item' && 'durationMs' in item);
    expect(entry).toMatchObject({ tool: 'create_item', isError: false });
    expect(typeof entry?.durationMs).toBe('number');
  });
});

function entriesOf(lines: string[]): Record<string, unknown>[] {
  return lines.flatMap((line) => {
    try {
      const entry = JSON.parse(line) as unknown;
      return typeof entry === 'object' && entry !== null ? [entry as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

function messagesOf(lines: string[]): string[] {
  return entriesOf(lines)
    .map((entry) => entry.msg)
    .filter((msg): msg is string => typeof msg === 'string');
}
