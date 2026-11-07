import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/agent/prompt';
import type { ThreadRow } from '../src/db/schema';

describe('场景：Agent 提示词 · 时间与空结果约束', () => {
  it('明确禁止为只有日期的待办编造默认时间，并要求 finish 非空', () => {
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

    // then：日期型待办不得补时间，finish 不得为空
    expect(prompt).toContain('绝不编造或补默认时间');
    expect(prompt).toContain('明天');
    expect(prompt).toContain('周五');
    expect(prompt).toContain('省略 dueAt');
    expect(prompt).toContain('只有用户明确要求提醒');
    expect(prompt).toContain('问清具体时间');
    expect(prompt).toContain('reply、summary、keyPoints、actions 至少有一个非空');
  });
});
