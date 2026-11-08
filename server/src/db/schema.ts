import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const threads = sqliteTable(
  'threads',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['daily', 'meeting'] }).notNull(),
    title: text('title').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('threads_one_daily_per_user')
      .on(table.userId)
      .where(sql`${table.kind} = 'daily'`),
    index('threads_user_updated_idx').on(table.userId, table.updatedAt),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    payloadJson: text('payload_json'),
    clientMessageId: text('client_message_id'),
    userMessageId: text('user_message_id'),
    responseJson: text('response_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('messages_thread_client_message_id')
      .on(table.threadId, table.clientMessageId)
      .where(sql`${table.clientMessageId} is not null`),
    index('messages_thread_created_idx').on(table.threadId, table.createdAt),
    index('messages_user_message_idx').on(table.userMessageId),
  ],
);

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['reminder', 'todo'] }).notNull(),
    title: text('title').notNull(),
    dueAt: text('due_at'),
    scheduledAt: text('scheduled_at'),
    sourceMessageId: text('source_message_id'),
    candidateIndex: integer('candidate_index'),
    status: text('status', { enum: ['open', 'done', 'deleted'] }).notNull().default('open'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('items_user_status_idx').on(table.userId, table.status),
    index('items_thread_idx').on(table.threadId),
    uniqueIndex('items_candidate_unique')
      .on(table.threadId, table.sourceMessageId, table.candidateIndex)
      .where(sql`${table.sourceMessageId} is not null and ${table.candidateIndex} is not null and ${table.status} != 'deleted'`),
  ],
);

export const toolCalls = sqliteTable(
  'tool_calls',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    toolCallId: text('tool_call_id'),
    name: text('name', {
      enum: ['create_item', 'update_item', 'delete_item', 'complete_item', 'search_items', 'finish'],
    }).notNull(),
    argumentsJson: text('arguments_json').notNull(),
    resultJson: text('result_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('tool_calls_message_idx').on(table.messageId)],
);

export const usageDaily = sqliteTable(
  'usage_daily',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    used: integer('used').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('usage_daily_user_day').on(table.userId, table.day)],
);

export const recordings = sqliteTable(
  'recordings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['transcribing', 'completed', 'failed'] }).notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationMs: integer('duration_ms'),
    audioPath: text('audio_path'),
    transcriptJson: text('transcript_json'),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    errorCode: text('error_code', {
      enum: ['TRANSCRIPTION_FAILED', 'QUOTA_EXCEEDED', 'INTERRUPTED'],
    }),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('recordings_user_created_idx').on(table.userId, table.createdAt),
    index('recordings_status_idx').on(table.status),
  ],
);

export const devices = sqliteTable(
  'devices',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (table) => [index('devices_user_idx').on(table.userId)],
);

export const deviceUtterances = sqliteTable(
  'device_utterances',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['processing', 'completed', 'failed'] }).notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationMs: integer('duration_ms'),
    audioPath: text('audio_path'),
    transcriptJson: text('transcript_json'),
    replyText: text('reply_text'),
    replyAudioPath: text('reply_audio_path'),
    errorCode: text('error_code', {
      enum: ['TRANSCRIPTION_FAILED', 'QUOTA_EXCEEDED', 'AGENT_FAILED', 'INTERRUPTED'],
    }),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('device_utterances_device_created_idx').on(table.deviceId, table.createdAt),
    index('device_utterances_status_idx').on(table.status),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type ThreadRow = typeof threads.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type ToolCallRow = typeof toolCalls.$inferSelect;
export type UsageDailyRow = typeof usageDaily.$inferSelect;
export type RecordingRow = typeof recordings.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type DeviceUtteranceRow = typeof deviceUtterances.$inferSelect;
