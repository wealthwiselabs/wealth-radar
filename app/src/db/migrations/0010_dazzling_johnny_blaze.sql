CREATE TABLE `suppressed_plaid_accounts` (
	`plaid_account_id` text PRIMARY KEY NOT NULL,
	`plaid_item_id` text,
	`institution` text DEFAULT '' NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`mask` text,
	`created_at` text NOT NULL
);
