CREATE TYPE "public"."trip_poll_kind" AS ENUM('dates', 'place');--> statement-breakpoint
CREATE TABLE "decision_nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slot_id" uuid,
	"poll_id" uuid,
	"deadline" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_nudges_one_subject" CHECK (num_nonnulls("decision_nudges"."slot_id", "decision_nudges"."poll_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "decision_nudges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_poll_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"label" text,
	"created_by_user_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_poll_options_shape" CHECK (case when "trip_poll_options"."label" is null
        then "trip_poll_options"."starts_on" is not null and "trip_poll_options"."ends_on" is not null and "trip_poll_options"."ends_on" >= "trip_poll_options"."starts_on"
        else "trip_poll_options"."starts_on" is null and "trip_poll_options"."ends_on" is null end),
	CONSTRAINT "trip_poll_options_label_length" CHECK (char_length("trip_poll_options"."label") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "trip_poll_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_poll_votes" (
	"option_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"vote" "option_vote" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_poll_votes_option_id_user_id_pk" PRIMARY KEY("option_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "trip_poll_votes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" "trip_poll_kind" NOT NULL,
	"decide_by" date,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_polls_trip_kind_unique" UNIQUE("trip_id","kind")
);
--> statement-breakpoint
ALTER TABLE "trip_polls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decision_nudges" ADD CONSTRAINT "decision_nudges_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_nudges" ADD CONSTRAINT "decision_nudges_slot_id_itinerary_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."itinerary_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_nudges" ADD CONSTRAINT "decision_nudges_poll_id_trip_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."trip_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_poll_options" ADD CONSTRAINT "trip_poll_options_poll_id_trip_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."trip_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_poll_options" ADD CONSTRAINT "trip_poll_options_created_by_user_id_profiles_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_poll_votes" ADD CONSTRAINT "trip_poll_votes_option_id_trip_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."trip_poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_poll_votes" ADD CONSTRAINT "trip_poll_votes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_polls" ADD CONSTRAINT "trip_polls_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_polls" ADD CONSTRAINT "trip_polls_created_by_user_id_profiles_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_nudges_user_idx" ON "decision_nudges" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_nudges_slot_unique" ON "decision_nudges" USING btree ("slot_id","user_id","deadline") WHERE "decision_nudges"."slot_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_nudges_poll_unique" ON "decision_nudges" USING btree ("poll_id","user_id","deadline") WHERE "decision_nudges"."poll_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_poll_options_poll_idx" ON "trip_poll_options" USING btree ("poll_id","sort_order");--> statement-breakpoint
CREATE INDEX "trip_poll_options_created_by_idx" ON "trip_poll_options" USING btree ("created_by_user_id") WHERE "trip_poll_options"."created_by_user_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_poll_votes_user_idx" ON "trip_poll_votes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trip_polls_created_by_idx" ON "trip_polls" USING btree ("created_by_user_id") WHERE "trip_polls"."created_by_user_id" is not null;--> statement-breakpoint
CREATE TRIGGER "trip_polls_set_updated_at" BEFORE INSERT OR UPDATE ON "trip_polls" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "trip_poll_options_set_updated_at" BEFORE INSERT OR UPDATE ON "trip_poll_options" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "trip_poll_votes_set_updated_at" BEFORE INSERT OR UPDATE ON "trip_poll_votes" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
-- A poll is part of its trip, and a vote part of its option, so each change moves its parent's updated_at.
CREATE TRIGGER "trip_polls_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "trip_polls" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('trips', 'id', 'trip_id');--> statement-breakpoint
CREATE TRIGGER "trip_poll_options_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "trip_poll_options" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('trip_polls', 'id', 'poll_id');--> statement-breakpoint
CREATE TRIGGER "trip_poll_votes_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "trip_poll_votes" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('trip_poll_options', 'id', 'option_id');--> statement-breakpoint
-- Who can see a trip's polls: its household, and guests who have been let in.
CREATE FUNCTION "private"."can_see_trip"(trip uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM "public"."trips" t
      WHERE t.id = trip AND "private"."member_role"(t.household_id) IS NOT NULL
    ) OR EXISTS (
      SELECT 1 FROM "public"."trip_guests" g
      WHERE g.trip_id = trip AND g.user_id = (SELECT auth.uid()) AND g.approved_at IS NOT NULL
    )
  $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "private"."can_see_trip"(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "private"."can_see_trip"(uuid) TO authenticated;--> statement-breakpoint
CREATE POLICY "people on the trip read its polls" ON "trip_polls"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."can_see_trip"("trip_id"));--> statement-breakpoint
CREATE POLICY "people on the trip read its poll options" ON "trip_poll_options"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM "public"."trip_polls" p WHERE p.id = "trip_poll_options"."poll_id" AND "private"."can_see_trip"(p.trip_id)));--> statement-breakpoint
CREATE POLICY "people on the trip read its poll votes" ON "trip_poll_votes"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "public"."trip_poll_options" o
      JOIN "public"."trip_polls" p ON p.id = o.poll_id
      WHERE o.id = "trip_poll_votes"."option_id" AND "private"."can_see_trip"(p.trip_id)
    )
  );
-- decision_nudges has no policy on purpose: only the cron job reads it.
