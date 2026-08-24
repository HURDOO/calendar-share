ALTER TABLE `calendars` ADD `sync_window_start_date` text;--> statement-breakpoint
ALTER TABLE `calendars` ADD `sync_window_end_date` text;--> statement-breakpoint
ALTER TABLE `google_connections` ADD `calendar_list_sync_token` text;
