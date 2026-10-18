CREATE TABLE `fonts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`file` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`printer_id` text NOT NULL,
	`label_id` text,
	`name` text NOT NULL,
	`doc` text NOT NULL,
	`vars` text,
	`copies` integer DEFAULT 1 NOT NULL,
	`options` text,
	`status` text NOT NULL,
	`error` text,
	`tape_id` integer,
	`tape_mm` real,
	`user` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`doc` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tapes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text,
	`media_id` text NOT NULL,
	`kind` text NOT NULL,
	`tape` text,
	`text` text,
	`part_number` text,
	`note` text,
	`status` text DEFAULT 'owned' NOT NULL,
	`used_mm` real DEFAULT 0 NOT NULL,
	`first_seen` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_seen` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tapes_key_unique` ON `tapes` (`key`);