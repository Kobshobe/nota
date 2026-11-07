ALTER TABLE `items` ADD `source_message_id` text;--> statement-breakpoint
ALTER TABLE `items` ADD `candidate_index` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `items_candidate_unique` ON `items` (`thread_id`,`source_message_id`,`candidate_index`) WHERE "items"."source_message_id" is not null and "items"."candidate_index" is not null and "items"."status" != 'deleted';