CREATE TABLE `report_records` (
	`id` text PRIMARY KEY NOT NULL,
	`reference_number` text NOT NULL,
	`record_type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`reported_at` text NOT NULL,
	`registered_community` text NOT NULL,
	`site_address` text DEFAULT '' NOT NULL,
	`route_number` text DEFAULT '' NOT NULL,
	`service_type` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`priority` text DEFAULT 'Normal' NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`contact_medium` text DEFAULT '' NOT NULL,
	`employee_name` text NOT NULL,
	`employee_title` text DEFAULT '' NOT NULL,
	`customer_name` text DEFAULT '' NOT NULL,
	`customer_address` text DEFAULT '' NOT NULL,
	`customer_contact_information` text DEFAULT '' NOT NULL,
	`issue_description` text NOT NULL,
	`root_cause` text DEFAULT '' NOT NULL,
	`corrective_action` text DEFAULT '' NOT NULL,
	`resolution_description` text DEFAULT '' NOT NULL,
	`resolution_due_at` text DEFAULT '' NOT NULL,
	`resolved_at` text DEFAULT '' NOT NULL,
	`assigned_to` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_records_reference_number_unique` ON `report_records` (`reference_number`);--> statement-breakpoint
CREATE INDEX `idx_report_records_type_occurred` ON `report_records` (`record_type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_report_records_status` ON `report_records` (`status`);--> statement-breakpoint
CREATE INDEX `idx_report_records_community` ON `report_records` (`registered_community`);