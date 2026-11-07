CREATE TABLE `comment` (
	`_id` text PRIMARY KEY NOT NULL,
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
	`avatar` text NOT NULL
);

CREATE INDEX `idx_comment_url_created` ON `comment` (`url`,`created`);
CREATE INDEX `idx_comment_created` ON `comment` (`created`);
CREATE INDEX `idx_comment_ip_created` ON `comment` (`ip`,`created`);
CREATE TABLE `comment_upload` (
	`comment_id` text NOT NULL,
	`upload_key` text NOT NULL,
	`deleting` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`comment_id`, `upload_key`),
	FOREIGN KEY (`comment_id`) REFERENCES `comment`(`_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`upload_key`,`deleting`) REFERENCES `upload`(`key`,`deleting`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "comment_upload_active" CHECK("comment_upload"."deleting" = 0)
);

CREATE INDEX `idx_comment_upload_key` ON `comment_upload` (`upload_key`);
CREATE TABLE `config` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`value` text DEFAULT '' NOT NULL
);

CREATE TABLE `counter` (
	`url` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`time` integer NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);

CREATE TABLE `upload` (
	`key` text PRIMARY KEY NOT NULL,
	`delete_after` integer,
	`deleting` integer DEFAULT 0 NOT NULL
);

CREATE INDEX `idx_upload_delete_after` ON `upload` (`delete_after`,`key`) WHERE "upload"."delete_after" IS NOT NULL;
CREATE UNIQUE INDEX `upload_key_deleting` ON `upload` (`key`,`deleting`);
