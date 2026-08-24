CREATE TABLE `charging_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`energy_wh` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_charging_sessions_account_started` ON `charging_sessions` (`account_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `demo_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`credits_cents` integer NOT NULL,
	`scenario` text NOT NULL,
	`charger_status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `demo_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`product_id` text NOT NULL,
	`item` text NOT NULL,
	`price_cents` integer NOT NULL,
	`status` text NOT NULL,
	`delivered_days_ago` integer,
	`return_eligible` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_demo_orders_account_created` ON `demo_orders` (`account_id`,`created_at`);