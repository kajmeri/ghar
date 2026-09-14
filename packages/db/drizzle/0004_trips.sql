CREATE TYPE "public"."itinerary_item_kind" AS ENUM('flight', 'lodging', 'activity', 'meal', 'transport', 'note');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('idea', 'planned', 'booked', 'past');--> statement-breakpoint
CREATE TABLE "itinerary_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"day" date NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"kind" "itinerary_item_kind" NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"confirmation_code" text,
	"cost_cents" bigint,
	"booking_id" uuid,
	"url" text,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itinerary_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "packing_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"label" text NOT NULL,
	"assigned_user_id" uuid,
	"is_packed" boolean DEFAULT false NOT NULL,
	"category" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "packing_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "packing_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"label" text NOT NULL,
	"category" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "packing_template_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "packing_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "packing_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"destination" text,
	"url" text,
	"notes" text,
	"image_url" text,
	"votes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_ideas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_members" (
	"trip_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_members_trip_id_user_id_pk" PRIMARY KEY("trip_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "trip_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"destination" text,
	"starts_on" date,
	"ends_on" date,
	"status" "trip_status" DEFAULT 'idea' NOT NULL,
	"cover_image_url" text,
	"budget_cents" bigint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_dates_valid" CHECK (("trips"."starts_on" is null) = ("trips"."ends_on" is null) and ("trips"."ends_on" is null or "trips"."ends_on" >= "trips"."starts_on"))
);
--> statement-breakpoint
ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "plaid_transaction_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "trip_id" uuid;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_assigned_user_id_profiles_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_template_items" ADD CONSTRAINT "packing_template_items_template_id_packing_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."packing_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_templates" ADD CONSTRAINT "packing_templates_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_ideas" ADD CONSTRAINT "trip_ideas_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_ideas" ADD CONSTRAINT "trip_ideas_created_by_user_id_profiles_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "itinerary_items_trip_day_idx" ON "itinerary_items" USING btree ("trip_id","day","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "itinerary_items_trip_booking_idx" ON "itinerary_items" USING btree ("trip_id","booking_id");--> statement-breakpoint
CREATE INDEX "packing_items_trip_idx" ON "packing_items" USING btree ("trip_id","sort_order");--> statement-breakpoint
CREATE INDEX "packing_template_items_template_idx" ON "packing_template_items" USING btree ("template_id","sort_order");--> statement-breakpoint
CREATE INDEX "packing_templates_household_idx" ON "packing_templates" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "trip_ideas_household_idx" ON "trip_ideas" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "trip_members_user_idx" ON "trip_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trips_household_starts_idx" ON "trips" USING btree ("household_id","starts_on");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_household_trip_idx" ON "bookings" USING btree ("household_id","trip_id");--> statement-breakpoint
CREATE INDEX "transactions_trip_idx" ON "transactions" USING btree ("trip_id") WHERE "transactions"."trip_id" is not null;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_manual_or_plaid" CHECK (("transactions"."account_id" is null) = ("transactions"."plaid_transaction_id" is null));--> statement-breakpoint
CREATE POLICY "members read their household's trips" ON "trips"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IS NOT NULL);--> statement-breakpoint
CREATE POLICY "members read their household's trip ideas" ON "trip_ideas"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IS NOT NULL);--> statement-breakpoint
CREATE POLICY "members read their household's packing templates" ON "packing_templates"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IS NOT NULL);--> statement-breakpoint
CREATE POLICY "members read their household's trip members" ON "trip_members"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."trips" t
      WHERE t.id = "trip_members"."trip_id"
        AND "private"."member_role"(t.household_id) IS NOT NULL
    )
  );--> statement-breakpoint
CREATE POLICY "members read their household's itinerary items" ON "itinerary_items"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."trips" t
      WHERE t.id = "itinerary_items"."trip_id"
        AND "private"."member_role"(t.household_id) IS NOT NULL
    )
  );--> statement-breakpoint
CREATE POLICY "members read their household's packing items" ON "packing_items"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."trips" t
      WHERE t.id = "packing_items"."trip_id"
        AND "private"."member_role"(t.household_id) IS NOT NULL
    )
  );--> statement-breakpoint
CREATE POLICY "members read their household's packing template items" ON "packing_template_items"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."packing_templates" pt
      WHERE pt.id = "packing_template_items"."template_id"
        AND "private"."member_role"(pt.household_id) IS NOT NULL
    )
  );