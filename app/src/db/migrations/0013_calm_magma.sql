CREATE TABLE `balance_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`as_of` text NOT NULL,
	`month` text NOT NULL,
	`balance` real DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`value_low` real,
	`value_high` real,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `balsnap_month` ON `balance_snapshots` (`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `balsnap_account_asof` ON `balance_snapshots` (`account_id`,`as_of`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `review_interval_months` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `secured_by_account_id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `valuation_provider` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `valuation_ref` text;