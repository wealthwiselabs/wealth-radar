CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`institution` text NOT NULL,
	`mask` text,
	`account_class` text DEFAULT 'spending' NOT NULL,
	`type` text DEFAULT 'unknown' NOT NULL,
	`subtype` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`plaid_item_id` text,
	`plaid_account_id` text,
	`active_from_month` text,
	`closed_at_month` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_institution_name` ON `accounts` (`institution`,`name`);--> statement-breakpoint
CREATE TABLE `merchant_preferences` (
	`merchant_key` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`subcategory_id` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`last_used` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `monthly_aggregates` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`month` text NOT NULL,
	`category_id` text,
	`expense_total` real DEFAULT 0 NOT NULL,
	`income_total` real DEFAULT 0 NOT NULL,
	`net` real DEFAULT 0 NOT NULL,
	`txn_count` integer DEFAULT 0 NOT NULL,
	`derived_from_txns` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'pdf' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agg_account_month_cat` ON `monthly_aggregates` (`account_id`,`month`,`category_id`);--> statement-breakpoint
CREATE TABLE `plaid_items` (
	`id` text PRIMARY KEY NOT NULL,
	`plaid_item_id` text NOT NULL,
	`institution_id` text,
	`institution_name` text,
	`access_token` text NOT NULL,
	`cursor` text,
	`status` text DEFAULT 'healthy' NOT NULL,
	`error` text,
	`synced_through_month` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `statement_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`month` text NOT NULL,
	`source_file` text,
	`imported_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stmt_account_month` ON `statement_imports` (`account_id`,`month`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`month` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`category_id` text DEFAULT '' NOT NULL,
	`subcategory_id` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'pdf' NOT NULL,
	`external_id` text,
	`fingerprint` text NOT NULL,
	`plaid_category` text,
	`pending` integer DEFAULT false NOT NULL,
	`source_file` text,
	`superseded_by` text,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tx_account_date` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `tx_month` ON `transactions` (`month`);--> statement-breakpoint
CREATE INDEX `tx_fingerprint` ON `transactions` (`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `tx_account_external` ON `transactions` (`account_id`,`external_id`);