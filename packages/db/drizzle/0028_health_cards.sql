CREATE TYPE "public"."blood_type" AS ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');--> statement-breakpoint
CREATE TABLE "health_cards" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"blood_type" "blood_type",
	"allergies" text[] DEFAULT '{}'::text[] NOT NULL,
	"conditions" text[] DEFAULT '{}'::text[] NOT NULL,
	"doctor_contact_id" uuid,
	"insurance_document_id" uuid,
	"emergency_note" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_cards_allergies_count" CHECK (cardinality("health_cards"."allergies") <= 20),
	CONSTRAINT "health_cards_conditions_count" CHECK (cardinality("health_cards"."conditions") <= 20),
	CONSTRAINT "health_cards_note_length" CHECK (char_length("health_cards"."emergency_note") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "health_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "health_cards" ADD CONSTRAINT "health_cards_person_id_household_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."household_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_cards" ADD CONSTRAINT "health_cards_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_cards" ADD CONSTRAINT "health_cards_doctor_contact_id_contacts_id_fk" FOREIGN KEY ("doctor_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_cards" ADD CONSTRAINT "health_cards_insurance_document_id_documents_id_fk" FOREIGN KEY ("insurance_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_cards" ADD CONSTRAINT "health_cards_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_cards_household_idx" ON "health_cards" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "health_cards_doctor_idx" ON "health_cards" USING btree ("doctor_contact_id") WHERE "health_cards"."doctor_contact_id" is not null;--> statement-breakpoint
CREATE INDEX "health_cards_insurance_idx" ON "health_cards" USING btree ("insurance_document_id") WHERE "health_cards"."insurance_document_id" is not null;--> statement-breakpoint
CREATE INDEX "health_cards_updated_by_idx" ON "health_cards" USING btree ("updated_by") WHERE "health_cards"."updated_by" is not null;--> statement-breakpoint
CREATE TRIGGER "health_cards_set_updated_at" BEFORE INSERT OR UPDATE ON "health_cards" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE POLICY "health cards follow health records" ON "health_cards" AS PERMISSIVE FOR SELECT TO authenticated USING (
  "private"."member_role"("household_id") IN ('owner', 'adult')
  OR (
    "private"."member_role"("household_id") IS NOT NULL
    AND EXISTS (SELECT 1 FROM "public"."household_people" p WHERE p."id" = "person_id" AND p."user_id" = (SELECT auth.uid()))
  )
);
