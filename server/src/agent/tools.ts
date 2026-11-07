import type { AgentTool } from '@earendil-works/pi-agent-core';
import { arr, num, obj, oneOf, opt, str } from '@earendil-works/pi-schema';
import type { Staging } from './staging';

function result(details: object, terminate = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(details) }],
    details,
    terminate,
  };
}

const createItemParameters = obj({
  title: str({ minLength: 1, maxLength: 200, description: 'Item title in Chinese' }),
  kind: opt(oneOf(['reminder', 'todo'], { description: 'reminder needs dueAt; todo may omit it' })),
  dueAt: opt(
    str({
      description:
        'Only when the user explicitly stated a clock time. Omit for date-only phrases like 明天/周五. ISO 8601 with an explicit offset, e.g. 2026-11-08T10:00:00+08:00',
    }),
  ),
});

const updateItemParameters = obj({
  itemId: str({ minLength: 1, description: 'Existing item id or a temp id returned by create_item' }),
  title: opt(str({ minLength: 1, maxLength: 200 })),
  dueAt: opt(str({ description: 'ISO 8601 date-time with an explicit offset' })),
});

const itemIdParameters = obj({
  itemId: str({ minLength: 1, description: 'Existing item id or a temp id returned by create_item' }),
});

const searchParameters = obj({
  query: opt(str({ description: 'Substring of the item title' })),
  status: opt(oneOf(['open', 'done', 'deleted'])),
  threadId: opt(str({ description: 'Only search items in this thread' })),
});

const candidateActionParameters = obj({
  title: str({ minLength: 1, maxLength: 200 }),
  owner: opt(str({ maxLength: 100 })),
  dueAt: opt(str({ description: 'ISO 8601 date-time with an explicit +08:00 offset' })),
  evidence: opt(str({ maxLength: 1000 })),
  confidence: opt(num({ minimum: 0, maximum: 1 })),
});

const finishParameters = obj({
  reply: opt(str({ maxLength: 4000, description: 'Short conversational reply shown to the user' })),
  title: opt(str({ maxLength: 100, description: 'Meeting or note title' })),
  summary: opt(str({ maxLength: 8000 })),
  keyPoints: opt(arr(str({ maxLength: 1000 }), { maxItems: 20 })),
  actions: opt(arr(candidateActionParameters, { maxItems: 20 })),
});

export function createAgentTools(staging: Staging): AgentTool<any>[] {
  const createItem: AgentTool<typeof createItemParameters> = {
    name: 'create_item',
    label: 'Create item',
    description:
      'Create a reminder or todo. Use only for an explicit short command, never for candidates inferred from meeting notes. Returns a temp id that later update/delete/complete calls may use.',
    parameters: createItemParameters,
    executionMode: 'sequential',
    execute: async (_toolCallId, params) => {
      return result(staging.create(params));
    },
  };

  const updateItem: AgentTool<typeof updateItemParameters> = {
    name: 'update_item',
    label: 'Update item',
    description: 'Change the title or dueAt of an existing item. Provide itemId and at least one field.',
    parameters: updateItemParameters,
    executionMode: 'sequential',
    execute: async (_toolCallId, params) => {
      const { itemId, ...patch } = params;
      return result(staging.update(itemId, patch));
    },
  };

  const deleteItem: AgentTool<typeof itemIdParameters> = {
    name: 'delete_item',
    label: 'Delete item',
    description: 'Soft-delete an existing item. Resolve ambiguous references before calling this.',
    parameters: itemIdParameters,
    executionMode: 'sequential',
    execute: async (_toolCallId, params) => {
      return result(staging.delete(params.itemId));
    },
  };

  const completeItem: AgentTool<typeof itemIdParameters> = {
    name: 'complete_item',
    label: 'Complete item',
    description: 'Mark an existing item as done.',
    parameters: itemIdParameters,
    executionMode: 'sequential',
    execute: async (_toolCallId, params) => {
      return result(staging.complete(params.itemId));
    },
  };

  const searchItems: AgentTool<typeof searchParameters> = {
    name: 'search_items',
    label: 'Search items',
    description:
      'Search the current user\'s items by title substring, status, or thread. Use it to find an item id before updating, deleting, or completing.',
    parameters: searchParameters,
    executionMode: 'sequential',
    execute: async (_toolCallId, params) => {
      const found = staging.search(params);
      return result({ items: found });
    },
  };

  const finish: AgentTool<typeof finishParameters> = {
    name: 'finish',
    label: 'Finish',
    description:
      'Commit every staged item write and return the final structured response. Always call this exactly once at the end of the run. After it commits, no further item writes are allowed.',
    parameters: finishParameters,
    executionMode: 'sequential',
    execute: async (_toolCallId, params) => {
      if (!hasFinishContent(params)) {
        throw new Error(
          'finish requires at least one non-empty field: reply, summary, keyPoints, or actions',
        );
      }
      const payload = staging.stageFinish(params);
      return result({ finished: true, payload }, true);
    },
  };

  return [createItem, updateItem, deleteItem, completeItem, searchItems, finish];
}

function hasFinishContent(params: {
  reply?: string;
  summary?: string;
  keyPoints?: string[];
  actions?: unknown[];
}): boolean {
  return (
    Boolean(params.reply?.trim()) ||
    Boolean(params.summary?.trim()) ||
    (params.keyPoints ?? []).some((point) => point.trim().length > 0) ||
    (params.actions?.length ?? 0) > 0
  );
}
