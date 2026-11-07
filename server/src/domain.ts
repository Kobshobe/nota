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
  dueAt?: string;
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
