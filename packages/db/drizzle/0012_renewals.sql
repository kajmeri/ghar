CREATE TYPE "public"."renewal_kind" AS ENUM('registration', 'license', 'membership', 'policy', 'lease', 'other');--> statement-breakpoint
CREATE TABLE "renewals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "renewal_kind" DEFAULT 'other' NOT NULL,
	"expires_on" date NOT NULL,
	"cadence_months" smallint,
	"auto_renews" boolean DEFAULT false NOT NULL,
	"cost_cents" bigint,
	"provider" text,
	"reference_number" text,
	"url" text,
	"contact_id" uuid,
	"asset_id" uuid,
	"document_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renewals_title_length" CHECK (char_length("renewals"."title") between 1 and 120),
	CONSTRAINT "renewals_text_lengths" CHECK (char_length("renewals"."provider") <= 200
        and char_length("renewals"."reference_number") <= 200
        and char_length("renewals"."url") <= 2000
        and char_length("renewals"."notes") <= 4000),
	CONSTRAINT "renewals_cadence" CHECK ("renewals"."cadence_months" between 1 and 120),
	CONSTRAINT "renewals_cost" CHECK ("renewals"."cost_cents" between 1 and 100000000),
	CONSTRAINT "renewals_auto_renews_cadence" CHECK (not "renewals"."auto_renews" or "renewals"."cadence_months" is not null)
);
--> statement-breakpoint
ALTER TABLE "renewals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expiry_reminders" DROP CONSTRAINT "expiry_reminders_one_subject";--> statement-breakpoint
ALTER TABLE "sync_tombstones" DROP CONSTRAINT "sync_tombstones_entity";--> statement-breakpoint
ALTER TABLE "expiry_reminders" ADD COLUMN "renewal_id" uuid;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "renewals_household_expires_idx" ON "renewals" USING btree ("household_id","expires_on","id");--> statement-breakpoint
CREATE INDEX "renewals_contact_idx" ON "renewals" USING btree ("contact_id") WHERE "renewals"."contact_id" is not null;--> statement-breakpoint
CREATE INDEX "renewals_asset_idx" ON "renewals" USING btree ("asset_id") WHERE "renewals"."asset_id" is not null;--> statement-breakpoint
CREATE INDEX "renewals_document_idx" ON "renewals" USING btree ("document_id") WHERE "renewals"."document_id" is not null;--> statement-breakpoint
ALTER TABLE "expiry_reminders" ADD CONSTRAINT "expiry_reminders_renewal_id_renewals_id_fk" FOREIGN KEY ("renewal_id") REFERENCES "public"."renewals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expiry_reminders_renewal_unique" ON "expiry_reminders" USING btree ("renewal_id","threshold_days","expires_on") WHERE "expiry_reminders"."renewal_id" is not null;--> statement-breakpoint
ALTER TABLE "expiry_reminders" ADD CONSTRAINT "expiry_reminders_one_subject" CHECK (num_nonnulls("expiry_reminders"."document_id", "expiry_reminders"."asset_id", "expiry_reminders"."renewal_id") = 1);--> statement-breakpoint
ALTER TABLE "sync_tombstones" ADD CONSTRAINT "sync_tombstones_entity" CHECK ("sync_tombstones"."entity" in ('household', 'member', 'invitation', 'account', 'category', 'transaction', 'manual_account', 'manual_value', 'bill', 'bill_payment', 'trip', 'booking', 'itinerary_slot', 'trip_idea', 'packing_item', 'packing_template', 'calendar_link', 'event', 'contact', 'asset', 'document', 'renewal', 'maintenance', 'maintenance_log', 'booking_draft', 'digest_preferences'));--> statement-breakpoint
CREATE TRIGGER "renewals_set_updated_at" BEFORE INSERT OR UPDATE ON "renewals" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "renewals_record_tombstone" AFTER DELETE ON "renewals" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('renewal', 'id', '');--> statement-breakpoint
CREATE POLICY "members read their household's renewals" ON "renewals" AS PERMISSIVE FOR SELECT TO authenticated USING ("private"."member_role"("household_id") IS NOT NULL);
