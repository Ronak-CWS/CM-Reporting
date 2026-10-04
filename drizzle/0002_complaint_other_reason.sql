CREATE TABLE `report_complaint_details` (
	`record_id` text PRIMARY KEY NOT NULL,
	`category_other_reason` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `report_records`(`id`) ON UPDATE no action ON DELETE no action
);
