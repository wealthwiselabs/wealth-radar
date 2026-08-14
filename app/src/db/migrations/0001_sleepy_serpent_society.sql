DROP INDEX `accounts_institution_name`;--> statement-breakpoint
ALTER TABLE `accounts` ADD `owner` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `name_source` text DEFAULT 'derived' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_owner_institution_name_mask` ON `accounts` (`owner`,`institution`,`name`,coalesce(`mask`,''));--> statement-breakpoint
ALTER TABLE `plaid_items` ADD `owner` text DEFAULT '' NOT NULL;