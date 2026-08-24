CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_session_id` ON `messages` (`session_id`,`id`);--> statement-breakpoint
CREATE TABLE `return_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`order_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_return_requests_session_id` ON `return_requests` (`session_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`root_span_parent` text,
	`prompt_version` text NOT NULL,
	`model` text NOT NULL,
	`source` text DEFAULT 'interactive' NOT NULL,
	`scenario_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
