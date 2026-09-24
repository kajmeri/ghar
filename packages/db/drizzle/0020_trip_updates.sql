CREATE TYPE "public"."trip_update_kind" AS ENUM('post', 'decided', 'booked', 'dates', 'destination');--> statement-breakpoint
CREATE TABLE "trip_update_mutes" (
	"trip_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_update_mutes_trip_id_user_id_pk" PRIMARY KEY("trip_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "trip_update_mutes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" "trip_update_kind" NOT NULL,
	"author_user_id" uuid,
	"body" text,
	"label" text,
	"day" date,
	"ends_on" date,
	"detail" text,
	"slot_id" uuid,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_updates_body" CHECK (("trip_updates"."kind" = 'post') = ("trip_updates"."body" is not null) and ("trip_updates"."body" is null or char_length("trip_updates"."body") <= 2000))
);
--> statement-breakpoint
ALTER TABLE "trip_updates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_update_mutes" ADD CONSTRAINT "trip_update_mutes_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_update_mutes" ADD CONSTRAINT "trip_update_mutes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_updates" ADD CONSTRAINT "trip_updates_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_updates" ADD CONSTRAINT "trip_updates_author_user_id_profiles_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_updates" ADD CONSTRAINT "trip_updates_slot_id_itinerary_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."itinerary_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_update_mutes_user_idx" ON "trip_update_mutes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trip_updates_trip_idx" ON "trip_updates" USING btree ("trip_id","created_at");--> statement-breakpoint
CREATE INDEX "trip_updates_unsent_idx" ON "trip_updates" USING btree ("trip_id") WHERE "trip_updates"."emailed_at" is null;--> statement-breakpoint
CREATE INDEX "trip_updates_author_idx" ON "trip_updates" USING btree ("author_user_id") WHERE "trip_updates"."author_user_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_updates_slot_idx" ON "trip_updates" USING btree ("slot_id") WHERE "trip_updates"."slot_id" is not null;--> statement-breakpoint
-- Everyone on the trip reads its updates. Writes go through the data access layer only.
CREATE POLICY "people on the trip read its updates" ON "trip_updates"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."can_see_trip"("trip_id"));--> statement-breakpoint
-- A person sees only their own choice about email.
CREATE POLICY "people read their own update mutes" ON "trip_update_mutes"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("user_id" = (SELECT auth.uid()));
