CREATE TABLE "health_medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"dose" text,
	"contact_id" uuid,
	"started_on" date,
	"stopped_on" date,
	"refill_by" date,
	"supply_days" smallint,
	"last_refilled_on" date,
	"note" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_medicines_name_length" CHECK (char_length("health_medicines"."name") between 1 and 120),
	CONSTRAINT "health_medicines_dose_length" CHECK (char_length("health_medicines"."dose") between 1 and 120),
	CONSTRAINT "health_medicines_note_length" CHECK (char_length("health_medicines"."note") between 1 and 1000),
	CONSTRAINT "health_medicines_supply_days" CHECK ("health_medicines"."supply_days" between 1 and 365),
	CONSTRAINT "health_medicines_started_on" CHECK ("health_medicines"."started_on" >= date '1900-01-01'),
	CONSTRAINT "health_medicines_stopped_after_start" CHECK ("health_medicines"."stopped_on" >= "health_medicines"."started_on"),
	CONSTRAINT "health_medicines_refill_by" CHECK ("health_medicines"."refill_by" >= date '1900-01-01'),
	CONSTRAINT "health_medicines_stopped_no_refill" CHECK ("health_medicines"."stopped_on" is null or "health_medicines"."refill_by" is null)
);
--> statement-breakpoint
ALTER TABLE "health_medicines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "health_refill_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"medicine_id" uuid NOT NULL,
	"threshold_days" smallint NOT NULL,
	"refill_by" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_refill_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "health_medicines" ADD CONSTRAINT "health_medicines_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_medicines" ADD CONSTRAINT "health_medicines_person_id_household_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."household_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_medicines" ADD CONSTRAINT "health_medicines_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_medicines" ADD CONSTRAINT "health_medicines_added_by_profiles_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_refill_reminders" ADD CONSTRAINT "health_refill_reminders_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_refill_reminders" ADD CONSTRAINT "health_refill_reminders_medicine_id_health_medicines_id_fk" FOREIGN KEY ("medicine_id") REFERENCES "public"."health_medicines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_medicines_household_idx" ON "health_medicines" USING btree ("household_id","person_id");--> statement-breakpoint
CREATE INDEX "health_medicines_person_fk_idx" ON "health_medicines" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "health_medicines_refill_idx" ON "health_medicines" USING btree ("household_id","refill_by") WHERE "health_medicines"."refill_by" is not null;--> statement-breakpoint
CREATE INDEX "health_medicines_contact_idx" ON "health_medicines" USING btree ("contact_id") WHERE "health_medicines"."contact_id" is not null;--> statement-breakpoint
CREATE INDEX "health_medicines_added_by_idx" ON "health_medicines" USING btree ("added_by") WHERE "health_medicines"."added_by" is not null;--> statement-breakpoint
CREATE INDEX "health_refill_reminders_household_idx" ON "health_refill_reminders" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "health_refill_reminders_unique" ON "health_refill_reminders" USING btree ("medicine_id","threshold_days","refill_by");--> statement-breakpoint
CREATE TRIGGER "health_medicines_set_updated_at" BEFORE INSERT OR UPDATE ON "health_medicines" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE POLICY "health medicines follow health records" ON "health_medicines" AS PERMISSIVE FOR SELECT TO authenticated USING (
  "private"."member_role"("household_id") IN ('owner', 'adult')
  OR (
    "private"."member_role"("household_id") IS NOT NULL
    AND EXISTS (SELECT 1 FROM "public"."household_people" p WHERE p."id" = "person_id" AND p."user_id" = (SELECT auth.uid()))
  )
);
