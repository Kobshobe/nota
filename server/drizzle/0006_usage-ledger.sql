CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`state` text NOT NULL,
	`reason` text NOT NULL,
	`release_reason` text,
	`ref_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_events_user_key` ON `usage_events` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `usage_events_user_day` ON `usage_events` (`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `usage_events_state` ON `usage_events` (`state`);--> statement-breakpoint
ALTER TABLE `recordings` ADD `upload_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `recordings_user_upload_key` ON `recordings` (`user_id`,`upload_key`) WHERE "recordings"."upload_key" is not null;