CREATE TYPE "public"."health_event_kind" AS ENUM('vaccine', 'checkup', 'dental', 'eye', 'visit', 'test');--> statement-breakpoint
CREATE TABLE "health_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "health_event_kind" NOT NULL,
	"title" text NOT NULL,
	"occurred_on" date NOT NULL,
	"contact_id" uuid,
	"document_id" uuid,
	"note" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_events_title_length" CHECK (char_length("health_events"."title") between 1 and 120),
	CONSTRAINT "health_events_note_length" CHECK (char_length("health_events"."note") between 1 and 1000),
	CONSTRAINT "health_events_occurred_on" CHECK ("health_events"."occurred_on" >= date '1900-01-01')
);
--> statement-breakpoint
ALTER TABLE "health_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "health_events" ADD CONSTRAINT "health_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_events" ADD CONSTRAINT "health_events_person_id_household_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."household_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_events" ADD CONSTRAINT "health_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_events" ADD CONSTRAINT "health_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_events" ADD CONSTRAINT "health_events_added_by_profiles_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_events_person_idx" ON "health_events" USING btree ("household_id","person_id","occurred_on" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "health_events_person_fk_idx" ON "health_events" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "health_events_contact_idx" ON "health_events" USING btree ("contact_id") WHERE "health_events"."contact_id" is not null;--> statement-breakpoint
CREATE INDEX "health_events_document_idx" ON "health_events" USING btree ("document_id") WHERE "health_events"."document_id" is not null;--> statement-breakpoint
CREATE INDEX "health_events_added_by_idx" ON "health_events" USING btree ("added_by") WHERE "health_events"."added_by" is not null;--> statement-breakpoint
CREATE TRIGGER "health_events_set_updated_at" BEFORE INSERT OR UPDATE ON "health_events" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE POLICY "owners and adults see everyone's health records, others their own" ON "health_events" AS PERMISSIVE FOR SELECT TO authenticated USING (
  "private"."member_role"("household_id") IN ('owner', 'adult')
  OR (
    "private"."member_role"("household_id") IS NOT NULL
    AND EXISTS (SELECT 1 FROM "public"."household_people" p WHERE p."id" = "person_id" AND p."user_id" = (SELECT auth.uid()))
  )
);
