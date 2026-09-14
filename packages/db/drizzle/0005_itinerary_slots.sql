CREATE TYPE "public"."itinerary_cost_basis" AS ENUM('per_person', 'total');--> statement-breakpoint
CREATE TYPE "public"."itinerary_option_source" AS ENUM('manual', 'link', 'idea_board', 'booking');--> statement-breakpoint
CREATE TYPE "public"."itinerary_option_status" AS ENUM('candidate', 'chosen', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."itinerary_slot_band" AS ENUM('early', 'morning', 'midday', 'afternoon', 'evening', 'night');--> statement-breakpoint
CREATE TYPE "public"."itinerary_slot_kind" AS ENUM('meal', 'activity', 'transport', 'lodging', 'downtime', 'note');--> statement-breakpoint
CREATE TYPE "public"."itinerary_slot_status" AS ENUM('open', 'decided', 'booked', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."option_vote" AS ENUM('yes', 'maybe', 'no');--> statement-breakpoint
CREATE TABLE "itinerary_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"url" text,
	"image_url" text,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"cost_cents" bigint,
	"cost_basis" "itinerary_cost_basis" DEFAULT 'total' NOT NULL,
	"duration_minutes" integer,
	"opens_at" text,
	"closes_at" text,
	"closed_days" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"booking_required" boolean DEFAULT false NOT NULL,
	"booking_url" text,
	"booking_deadline" date,
	"confirmation_code" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" "itinerary_option_source" DEFAULT 'manual' NOT NULL,
	"booking_id" uuid,
	"status" "itinerary_option_status" DEFAULT 'candidate' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itinerary_options_hours" CHECK (("itinerary_options"."opens_at" is null) = ("itinerary_options"."closes_at" is null)
        and "itinerary_options"."opens_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "itinerary_options"."closes_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "itinerary_options_closed_days" CHECK ("itinerary_options"."closed_days" <@ '{0,1,2,3,4,5,6}'::integer[]),
	CONSTRAINT "itinerary_options_duration_positive" CHECK ("itinerary_options"."duration_minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "itinerary_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "itinerary_scaffold_dismissals" (
	"trip_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itinerary_scaffold_dismissals_trip_id_day_pk" PRIMARY KEY("trip_id","day")
);
--> statement-breakpoint
ALTER TABLE "itinerary_scaffold_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "itinerary_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"day" date NOT NULL,
	"band" "itinerary_slot_band" NOT NULL,
	"kind" "itinerary_slot_kind" NOT NULL,
	"label" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "itinerary_slot_status" DEFAULT 'open' NOT NULL,
	"chosen_option_id" uuid,
	"decide_by" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itinerary_slots_label_length" CHECK (char_length("itinerary_slots"."label") between 1 and 200),
	CONSTRAINT "itinerary_slots_choice_matches_status" CHECK (("itinerary_slots"."status" in ('decided', 'booked')) = ("itinerary_slots"."chosen_option_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "itinerary_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "option_votes" (
	"option_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"vote" "option_vote" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_votes_option_id_user_id_pk" PRIMARY KEY("option_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "option_votes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "itinerary_options" ADD CONSTRAINT "itinerary_options_slot_id_itinerary_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."itinerary_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_options" ADD CONSTRAINT "itinerary_options_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_options" ADD CONSTRAINT "itinerary_options_created_by_user_id_profiles_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_scaffold_dismissals" ADD CONSTRAINT "itinerary_scaffold_dismissals_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_slots" ADD CONSTRAINT "itinerary_slots_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_slots" ADD CONSTRAINT "itinerary_slots_chosen_option_id_itinerary_options_id_fk" FOREIGN KEY ("chosen_option_id") REFERENCES "public"."itinerary_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_votes" ADD CONSTRAINT "option_votes_option_id_itinerary_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."itinerary_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_votes" ADD CONSTRAINT "option_votes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "itinerary_options_slot_idx" ON "itinerary_options" USING btree ("slot_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "itinerary_options_booking_idx" ON "itinerary_options" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "itinerary_slots_trip_day_idx" ON "itinerary_slots" USING btree ("trip_id","day","band","sort_order");--> statement-breakpoint
CREATE INDEX "option_votes_user_idx" ON "option_votes" USING btree ("user_id");--> statement-breakpoint
-- Every itinerary item becomes a slot with the same id, holding one option that is already chosen.
-- The band comes from the item's start in the household's zone; an untimed stay goes in the evening
-- and anything else untimed in the morning. Flights become transport, labelled as flights.
INSERT INTO "itinerary_slots" ("id", "trip_id", "day", "band", "kind", "label", "starts_at", "ends_at", "sort_order", "status", "created_at", "updated_at")
SELECT
  i."id",
  i."trip_id",
  i."day",
  (CASE
    WHEN i."starts_at" IS NULL THEN CASE WHEN i."kind" = 'lodging' THEN 'evening' ELSE 'morning' END
    WHEN extract(hour FROM i."starts_at" AT TIME ZONE h."timezone") < 7 THEN 'early'
    WHEN extract(hour FROM i."starts_at" AT TIME ZONE h."timezone") < 11 THEN 'morning'
    WHEN extract(hour FROM i."starts_at" AT TIME ZONE h."timezone") < 14 THEN 'midday'
    WHEN extract(hour FROM i."starts_at" AT TIME ZONE h."timezone") < 17 THEN 'afternoon'
    WHEN extract(hour FROM i."starts_at" AT TIME ZONE h."timezone") < 21 THEN 'evening'
    ELSE 'night'
  END)::"itinerary_slot_band",
  (CASE WHEN i."kind" = 'flight' THEN 'transport' ELSE i."kind"::text END)::"itinerary_slot_kind",
  CASE i."kind"
    WHEN 'flight' THEN 'Flight'
    WHEN 'lodging' THEN 'Stay'
    WHEN 'activity' THEN 'Activity'
    WHEN 'meal' THEN 'Meal'
    WHEN 'transport' THEN 'Getting around'
    ELSE 'Note'
  END,
  i."starts_at",
  i."ends_at",
  i."sort_order",
  'open',
  i."created_at",
  i."updated_at"
FROM "itinerary_items" i
JOIN "trips" t ON t."id" = i."trip_id"
JOIN "households" h ON h."id" = t."household_id";--> statement-breakpoint
-- The item's own fields move to its option. A booking can now be on only one timeline; if an old
-- item for it was left behind on another trip, that copy keeps everything but the link.
INSERT INTO "itinerary_options" ("slot_id", "title", "subtitle", "url", "address", "lat", "lng", "cost_cents", "cost_basis", "confirmation_code", "source", "booking_id", "status", "sort_order", "notes", "created_at", "updated_at")
SELECT
  ranked."id",
  ranked."title",
  ranked."location",
  ranked."url",
  ranked."address",
  ranked."lat",
  ranked."lng",
  ranked."cost_cents",
  'total',
  ranked."confirmation_code",
  (CASE WHEN ranked."booking_id" IS NULL THEN 'manual' ELSE 'booking' END)::"itinerary_option_source",
  CASE WHEN ranked."booking_rank" = 1 THEN ranked."booking_id" END,
  'chosen',
  1000,
  ranked."notes",
  ranked."created_at",
  ranked."updated_at"
FROM (
  SELECT
    i.*,
    row_number() OVER (
      PARTITION BY i."booking_id"
      ORDER BY (i."trip_id" = b."trip_id") DESC NULLS LAST, i."created_at", i."id"
    ) AS "booking_rank"
  FROM "itinerary_items" i
  LEFT JOIN "bookings" b ON b."id" = i."booking_id"
) ranked;--> statement-breakpoint
UPDATE "itinerary_slots" s
SET
  "chosen_option_id" = o."id",
  "status" = (CASE WHEN o."source" = 'booking' THEN 'booked' ELSE 'decided' END)::"itinerary_slot_status"
FROM "itinerary_options" o
WHERE o."slot_id" = s."id";--> statement-breakpoint
DROP TABLE "itinerary_items";--> statement-breakpoint
DROP TYPE "public"."itinerary_item_kind";--> statement-breakpoint
CREATE POLICY "members read their household's itinerary slots" ON "itinerary_slots"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."trips" t
      WHERE t.id = "itinerary_slots"."trip_id"
        AND "private"."member_role"(t.household_id) IS NOT NULL
    )
  );--> statement-breakpoint
CREATE POLICY "members read their household's itinerary options" ON "itinerary_options"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."itinerary_slots" s
      JOIN "public"."trips" t ON t.id = s.trip_id
      WHERE s.id = "itinerary_options"."slot_id"
        AND "private"."member_role"(t.household_id) IS NOT NULL
    )
  );--> statement-breakpoint
CREATE POLICY "members read their household's option votes" ON "option_votes"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."itinerary_options" o
      JOIN "public"."itinerary_slots" s ON s.id = o.slot_id
      JOIN "public"."trips" t ON t.id = s.trip_id
      WHERE o.id = "option_votes"."option_id"
        AND "private"."member_role"(t.household_id) IS NOT NULL
    )
  );--> statement-breakpoint
CREATE POLICY "members read their household's scaffold dismissals" ON "itinerary_scaffold_dismissals"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."trips" t
      WHERE t.id = "itinerary_scaffold_dismissals"."trip_id"
        AND "private"."member_role"(t.household_id) IS NOT NULL
    )
  );