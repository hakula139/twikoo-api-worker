CREATE TABLE `comment` (
	`_id` text NOT NULL,
	`uid` text NOT NULL,
	`nick` text NOT NULL,
	`mail` text NOT NULL,
	`mailMd5` text NOT NULL,
	`link` text NOT NULL,
	`ua` text NOT NULL,
	`ip` text NOT NULL,
	`ipRegion` text DEFAULT '' NOT NULL,
	`master` integer NOT NULL,
	`url` text NOT NULL,
	`href` text NOT NULL,
	`comment` text NOT NULL,
	`pid` text NOT NULL,
	`rid` text NOT NULL,
	`isSpam` integer NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`ups` text DEFAULT '[]' NOT NULL,
	`downs` text DEFAULT '[]' NOT NULL,
	`top` integer NOT NULL,
	`avatar` text NOT NULL,
	PRIMARY KEY(`url`, `created`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_comment_id` ON `comment` (`_id`);--> statement-breakpoint
CREATE INDEX `idx_comment_created` ON `comment` (`created`);--> statement-breakpoint
CREATE INDEX `idx_comment_ip_created` ON `comment` (`ip`,`created`);--> statement-breakpoint
CREATE TABLE `config` (
	`value` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `counter` (
	`url` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`time` integer NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
