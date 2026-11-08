DROP TABLE `device_utterances`;--> statement-breakpoint
ALTER TABLE `recordings` ADD `device_id` text REFERENCES devices(id);