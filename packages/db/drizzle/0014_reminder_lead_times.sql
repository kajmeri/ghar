ALTER TABLE "expiry_reminders" DROP CONSTRAINT "expiry_reminders_threshold";--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "warranty_remind_from_days" smallint;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "remind_from_days" smallint;--> statement-breakpoint
ALTER TABLE "renewals" ADD COLUMN "remind_from_days" smallint;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_warranty_remind_from" CHECK ("assets"."warranty_remind_from_days" between 7 and 365);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_remind_from" CHECK ("documents"."remind_from_days" between 7 and 365);--> statement-breakpoint
ALTER TABLE "expiry_reminders" ADD CONSTRAINT "expiry_reminders_threshold" CHECK ("expiry_reminders"."threshold_days" between 7 and 365);--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_remind_from" CHECK ("renewals"."remind_from_days" between 7 and 365);