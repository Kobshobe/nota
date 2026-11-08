CREATE TABLE `device_utterances` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`duration_ms` integer,
	`audio_path` text,
	`transcript_json` text,
	`reply_text` text,
	`reply_audio_path` text,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `device_utterances_device_created_idx` ON `device_utterances` (`device_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `device_utterances_status_idx` ON `device_utterances` (`status`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash_unique` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `devices_user_idx` ON `devices` (`user_id`);