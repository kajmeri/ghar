CREATE TYPE "public"."trip_guest_response" AS ENUM('going', 'maybe', 'not_going');--> statement-breakpoint
CREATE TYPE "public"."trip_guest_source" AS ENUM('email', 'link');--> statement-breakpoint
CREATE TABLE "trip_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"source" "trip_guest_source" NOT NULL,
	"response" "trip_guest_response",
	"party_size" smallint DEFAULT 1 NOT NULL,
	"approved_at" timestamp with time zone,
	"token_hash" text,
	"invited_by" uuid,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_guests_trip_email_unique" UNIQUE("trip_id","email"),
	CONSTRAINT "trip_guests_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "trip_guests_email_lowercase" CHECK ("trip_guests"."email" = lower("trip_guests"."email")),
	CONSTRAINT "trip_guests_party_size" CHECK ("trip_guests"."party_size" between 1 and 10),
	CONSTRAINT "trip_guests_source_shape" CHECK (case when "trip_guests"."source" = 'email' then "trip_guests"."token_hash" is not null else "trip_guests"."token_hash" is null and "trip_guests"."user_id" is not null end),
	CONSTRAINT "trip_guests_answered" CHECK (("trip_guests"."response" is null) = ("trip_guests"."responded_at" is null))
);
--> statement-breakpoint
ALTER TABLE "trip_guests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_share_links" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"token_sealed" text NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_share_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "trip_share_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_guests" ADD CONSTRAINT "trip_guests_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_guests" ADD CONSTRAINT "trip_guests_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_guests" ADD CONSTRAINT "trip_guests_invited_by_profiles_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_share_links" ADD CONSTRAINT "trip_share_links_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_share_links" ADD CONSTRAINT "trip_share_links_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_guests_trip_user_unique" ON "trip_guests" USING btree ("trip_id","user_id") WHERE "trip_guests"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_guests_user_idx" ON "trip_guests" USING btree ("user_id") WHERE "trip_guests"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_guests_invited_by_idx" ON "trip_guests" USING btree ("invited_by") WHERE "trip_guests"."invited_by" is not null;--> statement-breakpoint
CREATE INDEX "trip_share_links_created_by_idx" ON "trip_share_links" USING btree ("created_by") WHERE "trip_share_links"."created_by" is not null;--> statement-breakpoint
CREATE TRIGGER "trip_guests_set_updated_at" BEFORE INSERT OR UPDATE ON "trip_guests" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "trip_share_links_set_updated_at" BEFORE INSERT OR UPDATE ON "trip_share_links" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
-- Who is coming is part of the trip, so a change to the guest list moves the trip's updated_at.
CREATE TRIGGER "trip_guests_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "trip_guests" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('trips', 'id', 'trip_id');--> statement-breakpoint
CREATE POLICY "members read their household's trip guests" ON "trip_guests"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."trips" t
      WHERE t.id = "trip_guests"."trip_id"
        AND "private"."member_role"(t.household_id) IS NOT NULL
    )
  );--> statement-breakpoint
CREATE POLICY "guests read their own place on a trip" ON "trip_guests"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("user_id" = (SELECT auth.uid()));
-- trip_share_links has no policy on purpose: it holds a sealed token, so API roles can't read it.
