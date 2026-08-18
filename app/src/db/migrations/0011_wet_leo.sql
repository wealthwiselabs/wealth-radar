CREATE TABLE `agent_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agentmsg_conv` ON `agent_messages` (`conversation_id`,`created_at`);