CREATE TABLE `report_blockages` (
	`record_id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`reason_code` text NOT NULL,
	`reason_label` text NOT NULL,
	`street_from` text DEFAULT '' NOT NULL,
	`street_to` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`vehicle_plates` text DEFAULT '' NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `report_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `report_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `report_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_report_photos_record` ON `report_photos` (`record_id`,`position`);