import type { ItemRow } from './db/schema';

export type ThreadKind = 'daily' | 'meeting';
export type ItemKind = 'reminder' | 'todo';
export type ItemStatus = 'open' | 'done' | 'deleted';

export type ToolName =
  | 'create_item'
  | 'update_item'
  | 'delete_item'
  | 'complete_item'
  | 'search_items'
  | 'finish';

export interface CandidateAction {
  title: string;
  owner?: string;
  /** 截止时间：这件事必须在此之前完成。 */
  dueAt?: string;
  /** 执行时间：打算什么时候做；只有原文说了才算。 */
  scheduledAt?: string;
  evidence?: string;
  confidence?: number;
}

export interface MessagePayload {
  title?: string;
  summary?: string;
  keyPoints?: string[];
  actions?: CandidateAction[];
  reply?: string;
}

export interface ToolTrace {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  isError: boolean;
  createdAt: string;
}

export interface CommittedRun {
  payload: MessagePayload;
  items: ItemRow[];
}
