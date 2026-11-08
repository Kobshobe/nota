import { describe, expect, it } from 'vitest';
import { formatToolEnd, formatToolStart } from '../src/agent/tool-log';

describe('场景：日志 · 工具调用渲染成可读的一行', () => {
  it('create_item 打印中文标题、类型和本地时间', () => {
    // given：模型发起的创建请求
    const args = { title: '买牛奶', kind: 'todo', dueAt: '2026-11-08T10:00:00+08:00' };

    // when
    const line = formatToolStart('create_item', args);

    // then：字段是 key=value，不是 JSON
    expect(line).toBe('▶ create_item 标题=「买牛奶」 类型=待办 时间=2026-11-08 10:00');
    expect(line).not.toContain('{');
    expect(line).not.toContain('"');
  });

  it('create_item 结束时给出暂存 id 和类型', () => {
    const line = formatToolEnd(
      'create_item',
      { itemId: 'new_1', tempId: 'new_1', kind: 'reminder', title: '开会' },
      false,
      3,
    );

    expect(line).toBe('✔ create_item 已暂存 new_1（提醒） 3ms');
  });

  it('search_items 列出命中的标题，超过五条用省略号', () => {
    const items = ['买牛奶', '周报', '回邮件', '订机票', '复盘', '写总结'].map((title) => ({ title }));

    const line = formatToolEnd('search_items', { items }, false, 8);

    expect(line).toBe('✔ search_items 命中 6 条：买牛奶、周报、回邮件、订机票、复盘… 8ms');
  });

  it('search_items 没有命中时说明结果为空', () => {
    expect(formatToolEnd('search_items', { items: [] }, false, 1)).toBe(
      '✔ search_items 没有匹配的事项 1ms',
    );
  });

  it('finish 汇总标题、回复、摘要、要点和候选数量', () => {
    const args = {
      title: '周会',
      reply: '已整理',
      summary: '讨论了三个议题',
      keyPoints: ['a', 'b', 'c'],
      actions: [{ title: 'x' }, { title: 'y' }],
    };

    expect(formatToolStart('finish', args)).toBe(
      '▶ finish 标题=「周会」 回复=「已整理」 摘要=7 字 要点=3 条 候选=2 条',
    );
    expect(formatToolEnd('finish', { finished: true, payload: args }, false, 12)).toBe(
      '✔ finish 已暂存结果：标题、回复、摘要、3 条要点、2 条候选 12ms',
    );
  });

  it('失败的工具有独立标记并保留原始错误', () => {
    const line = formatToolEnd('create_item', { error: 'A reminder requires dueAt' }, true, 2);

    expect(line).toBe('✘ create_item 失败：A reminder requires dueAt 2ms');
  });

  it('长文本截断，避免一行日志被撑爆', () => {
    const title = '这是一段很长的标题'.repeat(20);

    const line = formatToolStart('create_item', { title });

    expect(line.length).toBeLessThan(120);
    expect(line).toContain('…');
    expect(line).not.toContain('{');
  });

  it('换行和控制字符被压成一行，没法伪造第二条日志', () => {
    const line = formatToolStart('create_item', { title: '买\n牛奶\t\u001b[31m' });

    expect(line).toBe('▶ create_item 标题=「买 牛奶 [31m」');
    expect(line).not.toContain('\n');
    expect(line).not.toContain('\u001b');
  });

  it('查询结果的标题也截断，单行不会过长', () => {
    const line = formatToolEnd('search_items', { items: [{ title: '长'.repeat(200) }] }, false, 1);

    expect(line.length).toBeLessThan(100);
    expect(line).toContain('…');
  });

  it('非字符串参数不抛错', () => {
    expect(formatToolStart('create_item', { title: 42 })).toBe('▶ create_item 标题=「42」');
    expect(() => formatToolStart('create_item', { title: { nested: 1 } })).not.toThrow();
    expect(formatToolStart('create_item', { title: { nested: 1 } })).toBe('▶ create_item 标题=（空）');
  });

  it('缺失字段不产生 undefined', () => {
    expect(formatToolStart('search_items', {})).toBe('▶ search_items 全部事项');
    expect(formatToolStart('finish', {})).toBe('▶ finish 无内容');
    expect(formatToolEnd('create_item', {}, false, 0)).toBe('✔ create_item 已暂存新建 0ms');
  });
});
