CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "admin_sessions_expiry" CHECK("admin_sessions"."expires_at" > "admin_sessions"."created_at"),
	CONSTRAINT "admin_sessions_last_used" CHECK("admin_sessions"."last_used_at" >= "admin_sessions"."created_at" and "admin_sessions"."last_used_at" <= "admin_sessions"."expires_at"),
	CONSTRAINT "admin_sessions_revoked" CHECK("admin_sessions"."revoked_at" is null or "admin_sessions"."revoked_at" >= "admin_sessions"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_token_hash_unique` ON `admin_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `admin_sessions_expiry_idx` ON `admin_sessions` (`expires_at`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` integer NOT NULL,
	`google_calendar_id` text NOT NULL,
	`display_name` text NOT NULL,
	`color` text,
	`time_zone` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sync_token` text,
	`sync_status` text DEFAULT 'NEVER' NOT NULL,
	`last_synced_at` integer,
	`last_sync_error_code` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `google_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendars_sync_status" CHECK("calendars"."sync_status" in ('NEVER', 'SYNCING', 'READY', 'ERROR')),
	CONSTRAINT "calendars_is_primary" CHECK("calendars"."is_primary" in (0, 1)),
	CONSTRAINT "calendars_is_active" CHECK("calendars"."is_active" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendars_connection_google_id_unique` ON `calendars` (`connection_id`,`google_calendar_id`);--> statement-breakpoint
CREATE INDEX `calendars_active_idx` ON `calendars` (`connection_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`google_event_id` text NOT NULL,
	`status` text DEFAULT 'CONFIRMED' NOT NULL,
	`etag` text,
	`google_updated_at` integer,
	`is_all_day` integer NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`start_date` text,
	`end_date` text,
	`start_time_zone` text,
	`end_time_zone` text,
	`recurring_event_google_id` text,
	`original_starts_at` integer,
	`original_start_date` text,
	`visibility` text DEFAULT 'DEFAULT' NOT NULL,
	`title` text,
	`location` text,
	`description` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "events_status" CHECK("events"."status" in ('CONFIRMED', 'TENTATIVE', 'CANCELLED')),
	CONSTRAINT "events_visibility" CHECK("events"."visibility" in ('DEFAULT', 'PUBLIC', 'PRIVATE', 'CONFIDENTIAL')),
	CONSTRAINT "events_is_all_day" CHECK("events"."is_all_day" in (0, 1)),
	CONSTRAINT "events_time_shape" CHECK((
        "events"."is_all_day" = 0
        and "events"."starts_at" is not null
        and "events"."ends_at" is not null
        and "events"."ends_at" > "events"."starts_at"
        and "events"."start_date" is null
        and "events"."end_date" is null
      ) or (
        "events"."is_all_day" = 1
        and "events"."starts_at" is null
        and "events"."ends_at" is null
        and "events"."start_date" is not null
        and "events"."end_date" is not null
        and length("events"."start_date") = 10
        and length("events"."end_date") = 10
        and "events"."start_date" = date("events"."start_date")
        and "events"."end_date" = date("events"."end_date")
        and "events"."end_date" > "events"."start_date"
      )),
	CONSTRAINT "events_original_start_shape" CHECK("events"."original_starts_at" is null or "events"."original_start_date" is null),
	CONSTRAINT "events_private_details" CHECK("events"."visibility" <> 'PRIVATE' or (
        "events"."title" is null
        and "events"."location" is null
        and "events"."description" is null
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_calendar_google_id_unique` ON `events` (`calendar_id`,`google_event_id`);--> statement-breakpoint
CREATE INDEX `events_calendar_time_idx` ON `events` (`calendar_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `events_calendar_date_idx` ON `events` (`calendar_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `google_connections` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'DISCONNECTED' NOT NULL,
	`refresh_token_ciphertext` text,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`connected_at` integer,
	`last_synced_at` integer,
	`last_error_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "google_connections_singleton" CHECK("google_connections"."id" = 1),
	CONSTRAINT "google_connections_status" CHECK("google_connections"."status" in ('DISCONNECTED', 'CONNECTED', 'ERROR')),
	CONSTRAINT "google_connections_connected_token" CHECK("google_connections"."status" <> 'CONNECTED' or "google_connections"."refresh_token_ciphertext" is not null)
);
--> statement-breakpoint
CREATE TABLE `share_calendars` (
	`share_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`share_id`, `calendar_id`),
	FOREIGN KEY (`share_id`) REFERENCES `share_links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `share_calendars_calendar_idx` ON `share_calendars` (`calendar_id`);--> statement-breakpoint
CREATE TABLE `share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`calendar_scope` text DEFAULT 'ALL' NOT NULL,
	`token_hash` text NOT NULL,
	`event_start_date` text NOT NULL,
	`event_end_date` text NOT NULL,
	`access_starts_at` integer,
	`access_ends_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "share_links_name" CHECK(length(trim("share_links"."name")) > 0),
	CONSTRAINT "share_links_calendar_scope" CHECK("share_links"."calendar_scope" in ('ALL', 'SELECTED')),
	CONSTRAINT "share_links_event_date_range" CHECK(length("share_links"."event_start_date") = 10
        and length("share_links"."event_end_date") = 10
        and "share_links"."event_start_date" = date("share_links"."event_start_date")
        and "share_links"."event_end_date" = date("share_links"."event_end_date")
        and "share_links"."event_end_date" >= "share_links"."event_start_date"),
	CONSTRAINT "share_links_access_range" CHECK((
        "share_links"."access_starts_at" is null and "share_links"."access_ends_at" is null
      ) or (
        "share_links"."access_starts_at" is not null
        and "share_links"."access_ends_at" is not null
        and "share_links"."access_ends_at" > "share_links"."access_starts_at"
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_hash_unique` ON `share_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `share_links_access_idx` ON `share_links` (`revoked_at`,`access_ends_at`);--> statement-breakpoint
CREATE TABLE `sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` integer NOT NULL,
	`calendar_id` text,
	`kind` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 8 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`locked_at` integer,
	`finished_at` integer,
	`last_error_category` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `google_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sync_jobs_kind" CHECK("sync_jobs"."kind" in (
        'CALENDAR_LIST_SYNC',
        'CALENDAR_EVENTS_SYNC',
        'CALENDAR_WINDOW_SYNC',
        'WATCH_RENEWAL',
        'RECOVERY_SYNC'
      )),
	CONSTRAINT "sync_jobs_status" CHECK("sync_jobs"."status" in ('PENDING', 'RUNNING', 'RETRY', 'SUCCEEDED', 'FAILED')),
	CONSTRAINT "sync_jobs_attempts" CHECK("sync_jobs"."attempt_count" >= 0
        and "sync_jobs"."max_attempts" > 0
        and "sync_jobs"."attempt_count" <= "sync_jobs"."max_attempts"),
	CONSTRAINT "sync_jobs_locked_state" CHECK(("sync_jobs"."status" = 'RUNNING' and "sync_jobs"."locked_at" is not null)
        or ("sync_jobs"."status" <> 'RUNNING')),
	CONSTRAINT "sync_jobs_finished_state" CHECK(("sync_jobs"."status" in ('SUCCEEDED', 'FAILED') and "sync_jobs"."finished_at" is not null)
        or ("sync_jobs"."status" not in ('SUCCEEDED', 'FAILED') and "sync_jobs"."finished_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_jobs_active_dedupe_unique` ON `sync_jobs` (`dedupe_key`) WHERE "sync_jobs"."status" in ('PENDING', 'RUNNING', 'RETRY');--> statement-breakpoint
CREATE INDEX `sync_jobs_dequeue_idx` ON `sync_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `sync_jobs_calendar_idx` ON `sync_jobs` (`calendar_id`);--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visitor_sessions_token_hash_unique` ON `visitor_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `visitor_sessions_share_idx` ON `visitor_sessions` (`share_id`);--> statement-breakpoint
CREATE INDEX `visitor_sessions_expiry_idx` ON `visitor_sessions` (`expires_at`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `watch_channels` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`connection_id` integer NOT NULL,
	`calendar_id` text,
	`kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`verification_token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_message_number` text,
	`stopped_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `google_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "watch_channels_kind" CHECK("watch_channels"."kind" in ('CALENDAR_LIST', 'EVENTS')),
	CONSTRAINT "watch_channels_target" CHECK(("watch_channels"."kind" = 'CALENDAR_LIST' and "watch_channels"."calendar_id" is null)
        or ("watch_channels"."kind" = 'EVENTS' and "watch_channels"."calendar_id" is not null)),
	CONSTRAINT "watch_channels_expiry" CHECK("watch_channels"."expires_at" > "watch_channels"."created_at")
);
--> statement-breakpoint
CREATE INDEX `watch_channels_resource_idx` ON `watch_channels` (`resource_id`);--> statement-breakpoint
CREATE INDEX `watch_channels_expiry_idx` ON `watch_channels` (`stopped_at`,`expires_at`);