import type { ToolName } from '../domain';

const KIND_LABELS: Record<string, string> = { reminder: '提醒', todo: '待办' };
const STATUS_LABELS: Record<string, string> = { open: '未完成', done: '已完成', deleted: '已删除' };

const MAX_TEXT = 80;
const MAX_TITLE = 30;
const MAX_LISTED_ITEMS = 5;

/** 一行中文摘要：`▶ create_item 标题=「买牛奶」 类型=待办`。 */
export function formatToolStart(name: ToolName, args: Record<string, unknown>): string {
  const detail = describeArguments(name, args);
  return detail ? `▶ ${name} ${detail}` : `▶ ${name}`;
}

/** 一行中文结果：`✔ create_item 已暂存 new_1（待办） 3ms`。 */
export function formatToolEnd(
  name: ToolName,
  result: Record<string, unknown>,
  isError: boolean,
  durationMs: number,
): string {
  const cost = ` ${Math.max(Math.round(durationMs), 0)}ms`;
  if (isError) return `✘ ${name} 失败：${errorText(result)}${cost}`;
  return `✔ ${name} ${describeResult(name, result)}${cost}`;
}

function describeArguments(name: ToolName, args: Record<string, unknown>): string {
  const parts: string[] = [];
  switch (name) {
    case 'create_item':
      parts.push(`标题=${quote(args.title)}`);
      if (args.kind !== undefined) parts.push(`类型=${label(KIND_LABELS, args.kind)}`);
      if (args.dueAt !== undefined) parts.push(`时间=${formatTime(args.dueAt)}`);
      break;
    case 'update_item':
      parts.push(`事项=${quote(args.itemId)}`);
      if (args.title !== undefined) parts.push(`新标题=${quote(args.title)}`);
      if (args.dueAt !== undefined) parts.push(`新时间=${formatTime(args.dueAt)}`);
      break;
    case 'delete_item':
    case 'complete_item':
      parts.push(`事项=${quote(args.itemId)}`);
      break;
    case 'search_items':
      if (args.query !== undefined) parts.push(`关键词=${quote(args.query)}`);
      if (args.status !== undefined) parts.push(`状态=${label(STATUS_LABELS, args.status)}`);
      if (args.threadId !== undefined) parts.push(`会话=${quote(args.threadId)}`);
      if (parts.length === 0) parts.push('全部事项');
      break;
    case 'finish':
      parts.push(...describeFinishArguments(args));
      break;
    default:
      parts.push('未知工具');
  }
  return parts.join(' ');
}

function describeFinishArguments(args: Record<string, unknown>): string[] {
  const parts: string[] = [];
  if (typeof args.title === 'string' && args.title.trim()) parts.push(`标题=${quote(args.title)}`);
  if (typeof args.reply === 'string' && args.reply.trim()) parts.push(`回复=${quote(args.reply)}`);
  if (typeof args.summary === 'string' && args.summary.trim()) {
    parts.push(`摘要=${args.summary.trim().length} 字`);
  }
  if (Array.isArray(args.keyPoints) && args.keyPoints.length > 0) {
    parts.push(`要点=${args.keyPoints.length} 条`);
  }
  if (Array.isArray(args.actions) && args.actions.length > 0) {
    parts.push(`候选=${args.actions.length} 条`);
  }
  return parts.length > 0 ? parts : ['无内容'];
}

function describeResult(name: ToolName, result: Record<string, unknown>): string {
  switch (name) {
    case 'create_item': {
      const id = text(result.itemId) || text(result.tempId);
      if (!id) return '已暂存新建';
      const kind = result.kind === undefined ? '' : `（${label(KIND_LABELS, result.kind)}）`;
      return `已暂存 ${id}${kind}`;
    }
    case 'update_item':
      return `已暂存修改 ${text(result.itemId) || '事项'}`;
    case 'delete_item':
      return `已暂存删除 ${text(result.itemId) || '事项'}`;
    case 'complete_item':
      return `已暂存完成 ${text(result.itemId) || '事项'}`;
    case 'search_items': {
      const found = Array.isArray(result.items) ? result.items : [];
      if (found.length === 0) return '没有匹配的事项';
      const titles = found
        .slice(0, MAX_LISTED_ITEMS)
        .map((entry) => (isRecord(entry) ? truncate(text(entry.title), MAX_TITLE) : ''))
        .filter(Boolean);
      const rest = found.length > MAX_LISTED_ITEMS ? '…' : '';
      const list = titles.length > 0 ? `：${titles.join('、')}${rest}` : '';
      return `命中 ${found.length} 条${list}`;
    }
    case 'finish': {
      const payload = isRecord(result.payload) ? result.payload : {};
      const parts: string[] = [];
      if (text(payload.title)) parts.push('标题');
      if (text(payload.reply)) parts.push('回复');
      if (text(payload.summary)) parts.push('摘要');
      if (Array.isArray(payload.keyPoints) && payload.keyPoints.length > 0) {
        parts.push(`${payload.keyPoints.length} 条要点`);
      }
      if (Array.isArray(payload.actions) && payload.actions.length > 0) {
        parts.push(`${payload.actions.length} 条候选`);
      }
      return parts.length > 0 ? `已暂存结果：${parts.join('、')}` : '已暂存结果';
    }
    default:
      return '完成';
  }
}

function errorText(result: Record<string, unknown>): string {
  return truncate(text(result.error) || '未知错误');
}

function label(labels: Record<string, string>, value: unknown): string {
  const raw = text(value);
  return labels[raw] ?? raw;
}

function quote(value: unknown): string {
  const raw = text(value);
  return raw ? `「${truncate(raw)}」` : '（空）';
}

function text(value: unknown): string {
  if (typeof value === 'string') return sanitize(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** 日志必须保持一行：控制字符换成空格，连续空白压成一个。 */
function sanitize(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 给运行级日志用的单行化 + 截断。 */
export function sanitizeLogText(value: string, max = 160): string {
  return truncate(sanitize(value), max);
}

function truncate(value: string, max = MAX_TEXT): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function formatTime(value: unknown): string {
  const raw = text(value);
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(raw);
  return match ? `${match[1]} ${match[2]}` : raw || '（空）';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
