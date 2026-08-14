ALTER TABLE `accounts` ADD `purpose` text DEFAULT 'portfolio' NOT NULL;--> statement-breakpoint
CREATE TABLE `cash_flows` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'contribution' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`confirmed` integer DEFAULT true NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `flow_account_date` ON `cash_flows` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `investment_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`as_of` text NOT NULL,
	`month` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`total_value` real DEFAULT 0 NOT NULL,
	`holdings_complete` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snap_account_asof` ON `investment_snapshots` (`account_id`,`as_of`);--> statement-breakpoint
CREATE INDEX `snap_month` ON `investment_snapshots` (`month`);--> statement-breakpoint
CREATE TABLE `securities` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text,
	`name` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`asset_type` text DEFAULT 'other' NOT NULL,
	`region` text,
	`cap` text,
	`style` text,
	`sector` text,
	`tag_source` text DEFAULT 'seed' NOT NULL,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `securities_ticker` ON `securities` (`ticker`) WHERE `ticker` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `security_purposes` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`security_id` text NOT NULL,
	`purpose` text NOT NULL,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secpurpose_account_security` ON `security_purposes` (`account_id`,`security_id`);--> statement-breakpoint
CREATE TABLE `snapshot_holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`security_id` text NOT NULL,
	`quantity` real,
	`value` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `investment_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holding_snapshot_security` ON `snapshot_holdings` (`snapshot_id`,`security_id`);
