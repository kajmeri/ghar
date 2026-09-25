CREATE TABLE "health_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"threshold_days" smallint NOT NULL,
	"due_on" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "health_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "health_event_kind" NOT NULL,
	"title" text,
	"cadence_months" smallint NOT NULL,
	"first_due_on" date NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_schedules_title_length" CHECK (char_length("health_schedules"."title") between 1 and 120),
	CONSTRAINT "health_schedules_cadence" CHECK ("health_schedules"."cadence_months" between 1 and 120),
	CONSTRAINT "health_schedules_first_due_on" CHECK ("health_schedules"."first_due_on" >= date '1900-01-01')
);
--> statement-breakpoint
ALTER TABLE "health_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "health_reminders" ADD CONSTRAINT "health_reminders_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_reminders" ADD CONSTRAINT "health_reminders_schedule_id_health_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."health_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_schedules" ADD CONSTRAINT "health_schedules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_schedules" ADD CONSTRAINT "health_schedules_person_id_household_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."household_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_schedules" ADD CONSTRAINT "health_schedules_added_by_profiles_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_reminders_household_idx" ON "health_reminders" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "health_reminders_unique" ON "health_reminders" USING btree ("schedule_id","threshold_days","due_on");--> statement-breakpoint
CREATE INDEX "health_schedules_household_idx" ON "health_schedules" USING btree ("household_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "health_schedules_unique" ON "health_schedules" USING btree ("person_id","kind",lower(coalesce("title", '')));--> statement-breakpoint
CREATE INDEX "health_schedules_added_by_idx" ON "health_schedules" USING btree ("added_by") WHERE "health_schedules"."added_by" is not null;--> statement-breakpoint
CREATE TRIGGER "health_schedules_set_updated_at" BEFORE INSERT OR UPDATE ON "health_schedules" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE POLICY "health schedules follow health records" ON "health_schedules" AS PERMISSIVE FOR SELECT TO authenticated USING (
  "private"."member_role"("household_id") IN ('owner', 'adult')
  OR (
    "private"."member_role"("household_id") IS NOT NULL
    AND EXISTS (SELECT 1 FROM "public"."household_people" p WHERE p."id" = "person_id" AND p."user_id" = (SELECT auth.uid()))
  )
);
