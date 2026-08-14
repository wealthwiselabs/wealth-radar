CREATE TABLE `category_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`pattern` text NOT NULL,
	`category_id` text NOT NULL,
	`subcategory_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rules_pattern` ON `category_rules` (`pattern`);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `category_source` text DEFAULT 'ai' NOT NULL;
