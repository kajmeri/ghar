ALTER TYPE "public"."document_kind" ADD VALUE 'passport' BEFORE 'property';--> statement-breakpoint
CREATE TABLE "household_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_people_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "household_people_account_or_name" CHECK (("household_people"."user_id" is null) = ("household_people"."name" is not null)),
	CONSTRAINT "household_people_name_length" CHECK (char_length("household_people"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "household_people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_travellers" (
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_travellers_trip_id_person_id_pk" PRIMARY KEY("trip_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "trip_travellers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_tombstones" DROP CONSTRAINT "sync_tombstones_entity";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "renewals" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "international" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "household_people" ADD CONSTRAINT "household_people_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_people" ADD CONSTRAINT "household_people_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_travellers" ADD CONSTRAINT "trip_travellers_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_travellers" ADD CONSTRAINT "trip_travellers_person_id_household_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."household_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "household_people_household_idx" ON "household_people" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "trip_travellers_person_idx" ON "trip_travellers" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_person_id_household_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."household_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_person_id_household_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."household_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_person_idx" ON "documents" USING btree ("person_id") WHERE "documents"."person_id" is not null;--> statement-breakpoint
CREATE INDEX "renewals_person_idx" ON "renewals" USING btree ("person_id") WHERE "renewals"."person_id" is not null;--> statement-breakpoint
ALTER TABLE "sync_tombstones" ADD CONSTRAINT "sync_tombstones_entity" CHECK ("sync_tombstones"."entity" in ('household', 'member', 'person', 'invitation', 'account', 'category', 'transaction', 'manual_account', 'manual_value', 'bill', 'bill_payment', 'trip', 'booking', 'itinerary_slot', 'trip_idea', 'packing_item', 'packing_template', 'calendar_link', 'event', 'contact', 'asset', 'document', 'renewal', 'maintenance', 'maintenance_log', 'booking_draft', 'digest_preferences'));--> statement-breakpoint
-- Everyone already in a household is one of its people. Their names stay on their profiles.
INSERT INTO "household_people" ("household_id", "user_id", "created_at")
SELECT "household_id", "user_id", "joined_at" FROM "household_members";--> statement-breakpoint
-- Who was going on each trip, now by person. trip_members goes in the next migration.
INSERT INTO "trip_travellers" ("trip_id", "person_id", "created_at")
SELECT tm."trip_id", p."id", tm."created_at"
FROM "trip_members" tm
JOIN "trips" t ON t."id" = tm."trip_id"
JOIN "household_people" p ON p."user_id" = tm."user_id" AND p."household_id" = t."household_id";--> statement-breakpoint
CREATE TRIGGER "household_people_set_updated_at" BEFORE INSERT OR UPDATE ON "household_people" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "household_people_record_tombstone" AFTER DELETE ON "household_people" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('person', 'id', '');--> statement-breakpoint
-- A member's person row carries their name, which lives on profiles.
CREATE TRIGGER "profiles_touch_people" AFTER UPDATE ON "profiles" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('household_people', 'user_id', 'id');--> statement-breakpoint
CREATE TRIGGER "trip_travellers_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "trip_travellers" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('trips', 'id', 'trip_id');--> statement-breakpoint
CREATE POLICY "members read their household's people" ON "household_people" AS PERMISSIVE FOR SELECT TO authenticated USING ("private"."member_role"("household_id") IS NOT NULL);--> statement-breakpoint
CREATE POLICY "members read their household's trip travellers" ON "trip_travellers"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."trips" t
      WHERE t.id = "trip_travellers"."trip_id"
        AND "private"."member_role"(t.household_id) IS NOT NULL
    )
  );
