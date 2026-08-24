CREATE TABLE `demo_orders_v2` (
	`id` text PRIMARY KEY NOT NULL,
	`order_number` text NOT NULL,
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
CREATE INDEX `idx_demo_orders_v2_account_created` ON `demo_orders_v2` (`account_id`,`created_at`);