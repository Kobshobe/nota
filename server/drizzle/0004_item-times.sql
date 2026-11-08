ALTER TABLE `items` ADD `scheduled_at` text;
--> statement-breakpoint
UPDATE `items` SET `scheduled_at` = `due_at` WHERE `kind` = 'todo' AND `due_at` IS NOT NULL;
