import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/agent/prompt';
import type { ThreadRow } from '../src/db/schema';

describe('场景：Agent 提示词 · 时间与空结果约束', () => {
  it('区分提醒时间、待办截止时间和执行时间，并要求 finish 非空', () => {
    // given：日常 thread
    const thread: ThreadRow = {
      id: 'thread-1',
      userId: 'user-1',
      kind: 'daily',
      title: '日常',
      createdAt: '2026-11-08T02:00:00.000Z',
      updatedAt: '2026-11-08T02:00:00.000Z',
    };

    // when
    const prompt = buildSystemPrompt({
      thread,
      items: [],
      now: new Date('2026-11-08T10:00:00+08:00'),
    });

    // then：截止时间不能丢，执行时间不能编，finish 不得为空
    expect(prompt).toContain('提醒（reminder）：dueAt 是通知时间');
    expect(prompt).toContain('待办截止时间（dueAt）');
    expect(prompt).toContain('待办执行时间（scheduledAt）');
    expect(prompt).toContain('「周五之前」「下周三之前」这种只有日期的说法也要填');
    expect(prompt).toContain('23:59:00+08:00');
    expect(prompt).toContain('没人说就留空，不要替用户排期');
    expect(prompt).toContain('reply、summary、keyPoints、actions 至少有一个非空');
    // 负责人不写编号，会议标题不用占位词
    expect(prompt).toContain('绝不写「说话人 1」这类编号');
    expect(prompt).toContain('不要用「新会议」这类占位词');
  });
});
