CREATE TABLE `investment_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`plaid_investment_txn_id` text NOT NULL,
	`security_id` text,
	`date` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`quantity` real,
	`price` real,
	`fees` real,
	`type` text DEFAULT '' NOT NULL,
	`subtype` text,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investment_transactions_plaid_investment_txn_id_unique` ON `investment_transactions` (`plaid_investment_txn_id`);--> statement-breakpoint
CREATE INDEX `invtxn_account_date` ON `investment_transactions` (`account_id`,`date`);--> statement-breakpoint
ALTER TABLE `cash_flows` ADD `source_ref` text;