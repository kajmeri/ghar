ALTER TYPE "public"."one_tap_action" ADD VALUE 'not_renewing_document';--> statement-breakpoint
ALTER TYPE "public"."one_tap_action" ADD VALUE 'not_renewing_warranty';--> statement-breakpoint
ALTER TYPE "public"."one_tap_action" ADD VALUE 'not_renewing_renewal';--> statement-breakpoint
CREATE TABLE "expiry_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"document_id" uuid,
	"asset_id" uuid,
	"renewal_id" uuid,
	"expires_on" date NOT NULL,
	"dismissed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expiry_dismissals_one_subject" CHECK (num_nonnulls("expiry_dismissals"."document_id", "expiry_dismissals"."asset_id", "expiry_dismissals"."renewal_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "expiry_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "action_tokens" DROP CONSTRAINT "action_tokens_due_on";--> statement-breakpoint
ALTER TABLE "expiry_dismissals" ADD CONSTRAINT "expiry_dismissals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_dismissals" ADD CONSTRAINT "expiry_dismissals_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_dismissals" ADD CONSTRAINT "expiry_dismissals_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_dismissals" ADD CONSTRAINT "expiry_dismissals_renewal_id_renewals_id_fk" FOREIGN KEY ("renewal_id") REFERENCES "public"."renewals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_dismissals" ADD CONSTRAINT "expiry_dismissals_dismissed_by_profiles_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expiry_dismissals_household_idx" ON "expiry_dismissals" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expiry_dismissals_document_unique" ON "expiry_dismissals" USING btree ("document_id","expires_on") WHERE "expiry_dismissals"."document_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "expiry_dismissals_asset_unique" ON "expiry_dismissals" USING btree ("asset_id","expires_on") WHERE "expiry_dismissals"."asset_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "expiry_dismissals_renewal_unique" ON "expiry_dismissals" USING btree ("renewal_id","expires_on") WHERE "expiry_dismissals"."renewal_id" is not null;--> statement-breakpoint
CREATE INDEX "expiry_dismissals_dismissed_by_idx" ON "expiry_dismissals" USING btree ("dismissed_by") WHERE "expiry_dismissals"."dismissed_by" is not null;--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_due_on" CHECK (("action_tokens"."action"::text in ('mark_bill_paid', 'not_renewing_document', 'not_renewing_warranty', 'not_renewing_renewal')) = ("action_tokens"."due_on" is not null));--> statement-breakpoint
CREATE POLICY "members read their household's expiry dismissals" ON "expiry_dismissals" AS PERMISSIVE FOR SELECT TO authenticated USING ("private"."member_role"("household_id") IS NOT NULL);