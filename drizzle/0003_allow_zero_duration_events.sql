PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_events` (
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
	CONSTRAINT "events_status" CHECK("__new_events"."status" in ('CONFIRMED', 'TENTATIVE', 'CANCELLED')),
	CONSTRAINT "events_visibility" CHECK("__new_events"."visibility" in ('DEFAULT', 'PUBLIC', 'PRIVATE', 'CONFIDENTIAL')),
	CONSTRAINT "events_is_all_day" CHECK("__new_events"."is_all_day" in (0, 1)),
	CONSTRAINT "events_time_shape" CHECK((
        "__new_events"."is_all_day" = 0
        and "__new_events"."starts_at" is not null
        and "__new_events"."ends_at" is not null
        and "__new_events"."ends_at" >= "__new_events"."starts_at"
        and "__new_events"."start_date" is null
        and "__new_events"."end_date" is null
      ) or (
        "__new_events"."is_all_day" = 1
        and "__new_events"."starts_at" is null
        and "__new_events"."ends_at" is null
        and "__new_events"."start_date" is not null
        and "__new_events"."end_date" is not null
        and length("__new_events"."start_date") = 10
        and length("__new_events"."end_date") = 10
        and "__new_events"."start_date" = date("__new_events"."start_date")
        and "__new_events"."end_date" = date("__new_events"."end_date")
        and "__new_events"."end_date" > "__new_events"."start_date"
      )),
	CONSTRAINT "events_original_start_shape" CHECK("__new_events"."original_starts_at" is null or "__new_events"."original_start_date" is null),
	CONSTRAINT "events_private_details" CHECK("__new_events"."visibility" <> 'PRIVATE' or (
        "__new_events"."title" is null
        and "__new_events"."location" is null
        and "__new_events"."description" is null
      ))
);
--> statement-breakpoint
INSERT INTO `__new_events`("id", "calendar_id", "google_event_id", "status", "etag", "google_updated_at", "is_all_day", "starts_at", "ends_at", "start_date", "end_date", "start_time_zone", "end_time_zone", "recurring_event_google_id", "original_starts_at", "original_start_date", "visibility", "title", "location", "description", "created_at", "updated_at") SELECT "id", "calendar_id", "google_event_id", "status", "etag", "google_updated_at", "is_all_day", "starts_at", "ends_at", "start_date", "end_date", "start_time_zone", "end_time_zone", "recurring_event_google_id", "original_starts_at", "original_start_date", "visibility", "title", "location", "description", "created_at", "updated_at" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `events_calendar_google_id_unique` ON `events` (`calendar_id`,`google_event_id`);--> statement-breakpoint
CREATE INDEX `events_calendar_time_idx` ON `events` (`calendar_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `events_calendar_date_idx` ON `events` (`calendar_id`,`start_date`,`end_date`);