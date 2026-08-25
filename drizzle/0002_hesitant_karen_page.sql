CREATE TABLE `__share_calendars_backup` AS
SELECT `share_id`, `calendar_id`, `created_at` FROM `share_calendars`;--> statement-breakpoint
CREATE TABLE `__visitor_sessions_backup` AS
SELECT `id`, `share_id`, `token_hash`, `expires_at`, `last_used_at`,
       `revoked_at`, `created_at`
FROM `visitor_sessions`;--> statement-breakpoint
DROP TABLE `share_calendars`;--> statement-breakpoint
DROP TABLE `visitor_sessions`;--> statement-breakpoint
CREATE TABLE `__new_share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`calendar_scope` text DEFAULT 'ALL' NOT NULL,
	`token_hash` text NOT NULL,
	`token_version` integer,
	`event_date_scope` text DEFAULT 'SELECTED' NOT NULL,
	`event_start_date` text,
	`event_end_date` text,
	`access_starts_at` integer,
	`access_ends_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "share_links_name" CHECK(length(trim("__new_share_links"."name")) > 0),
	CONSTRAINT "share_links_calendar_scope" CHECK("__new_share_links"."calendar_scope" in ('ALL', 'SELECTED')),
	CONSTRAINT "share_links_event_date_range" CHECK((
        "__new_share_links"."event_date_scope" = 'ALL'
        and "__new_share_links"."event_start_date" is null
        and "__new_share_links"."event_end_date" is null
      ) or (
        "__new_share_links"."event_date_scope" = 'SELECTED'
        and length("__new_share_links"."event_start_date") = 10
        and length("__new_share_links"."event_end_date") = 10
        and "__new_share_links"."event_start_date" = date("__new_share_links"."event_start_date")
        and "__new_share_links"."event_end_date" = date("__new_share_links"."event_end_date")
        and "__new_share_links"."event_end_date" >= "__new_share_links"."event_start_date"
      )),
	CONSTRAINT "share_links_event_date_scope" CHECK("__new_share_links"."event_date_scope" in ('ALL', 'SELECTED')),
	CONSTRAINT "share_links_token_version" CHECK("__new_share_links"."token_version" is null or "__new_share_links"."token_version" > 0),
	CONSTRAINT "share_links_access_range" CHECK((
        "__new_share_links"."access_starts_at" is null and "__new_share_links"."access_ends_at" is null
      ) or (
        "__new_share_links"."access_starts_at" is not null
        and "__new_share_links"."access_ends_at" is not null
        and "__new_share_links"."access_ends_at" > "__new_share_links"."access_starts_at"
      ))
);
--> statement-breakpoint
INSERT INTO `__new_share_links`("id", "name", "calendar_scope", "token_hash", "token_version", "event_date_scope", "event_start_date", "event_end_date", "access_starts_at", "access_ends_at", "revoked_at", "created_at", "updated_at") SELECT "id", "name", "calendar_scope", "token_hash", NULL, 'SELECTED', "event_start_date", "event_end_date", "access_starts_at", "access_ends_at", "revoked_at", "created_at", "updated_at" FROM `share_links`;--> statement-breakpoint
DROP TABLE `share_links`;--> statement-breakpoint
ALTER TABLE `__new_share_links` RENAME TO `share_links`;--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_hash_unique` ON `share_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `share_links_access_idx` ON `share_links` (`revoked_at`,`access_ends_at`);--> statement-breakpoint
CREATE TABLE `share_calendars` (
	`share_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`share_id`, `calendar_id`),
	FOREIGN KEY (`share_id`) REFERENCES `share_links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `share_calendars_calendar_idx` ON `share_calendars` (`calendar_id`);--> statement-breakpoint
INSERT INTO `share_calendars` (`share_id`, `calendar_id`, `created_at`)
SELECT `share_id`, `calendar_id`, `created_at`
FROM `__share_calendars_backup`;--> statement-breakpoint
CREATE TABLE `visitor_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`share_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`share_id`) REFERENCES `share_links`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "visitor_sessions_expiry" CHECK("visitor_sessions"."expires_at" > "visitor_sessions"."created_at"),
	CONSTRAINT "visitor_sessions_last_used" CHECK("visitor_sessions"."last_used_at" >= "visitor_sessions"."created_at" and "visitor_sessions"."last_used_at" <= "visitor_sessions"."expires_at"),
	CONSTRAINT "visitor_sessions_revoked" CHECK("visitor_sessions"."revoked_at" is null or "visitor_sessions"."revoked_at" >= "visitor_sessions"."created_at")
);--> statement-breakpoint
CREATE UNIQUE INDEX `visitor_sessions_token_hash_unique` ON `visitor_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `visitor_sessions_share_idx` ON `visitor_sessions` (`share_id`);--> statement-breakpoint
CREATE INDEX `visitor_sessions_expiry_idx` ON `visitor_sessions` (`expires_at`,`revoked_at`);--> statement-breakpoint
INSERT INTO `visitor_sessions` (
  `id`, `share_id`, `token_hash`, `expires_at`, `last_used_at`,
  `revoked_at`, `created_at`
)
SELECT `id`, `share_id`, `token_hash`, `expires_at`, `last_used_at`,
       `revoked_at`, `created_at`
FROM `__visitor_sessions_backup`;--> statement-breakpoint
DROP TABLE `__share_calendars_backup`;--> statement-breakpoint
DROP TABLE `__visitor_sessions_backup`;
