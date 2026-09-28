ALTER TABLE "maintenance_log" ADD COLUMN "last_done_before" date;--> statement-breakpoint
ALTER TABLE "maintenance_log" ADD COLUMN "next_due_before" date;