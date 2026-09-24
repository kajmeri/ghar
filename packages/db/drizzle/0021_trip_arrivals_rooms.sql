CREATE TYPE "public"."trip_arrival_direction" AS ENUM('arriving', 'leaving');--> statement-breakpoint
CREATE TYPE "public"."trip_arrival_mode" AS ENUM('flight', 'train', 'bus', 'car', 'other');--> statement-breakpoint
CREATE TABLE "trip_arrivals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid,
	"guest_id" uuid,
	"direction" "trip_arrival_direction" NOT NULL,
	"mode" "trip_arrival_mode" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"place" text,
	"number" text,
	"wants_ride" boolean DEFAULT false NOT NULL,
	"ride_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_arrivals_person_unique" UNIQUE("trip_id","person_id","direction"),
	CONSTRAINT "trip_arrivals_guest_unique" UNIQUE("trip_id","guest_id","direction"),
	CONSTRAINT "trip_arrivals_one_person" CHECK (("trip_arrivals"."person_id" is null) <> ("trip_arrivals"."guest_id" is null)),
	CONSTRAINT "trip_arrivals_ride_wanted" CHECK ("trip_arrivals"."ride_user_id" is null or "trip_arrivals"."wants_ride"),
	CONSTRAINT "trip_arrivals_place_length" CHECK (char_length("trip_arrivals"."place") <= 80),
	CONSTRAINT "trip_arrivals_number_length" CHECK (char_length("trip_arrivals"."number") <= 20)
);
--> statement-breakpoint
ALTER TABLE "trip_arrivals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_room_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"person_id" uuid,
	"guest_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_room_assignments_person_unique" UNIQUE("trip_id","person_id"),
	CONSTRAINT "trip_room_assignments_guest_unique" UNIQUE("trip_id","guest_id"),
	CONSTRAINT "trip_room_assignments_one_person" CHECK (("trip_room_assignments"."person_id" is null) <> ("trip_room_assignments"."guest_id" is null))
);
--> statement-breakpoint
ALTER TABLE "trip_room_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sleeps" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_rooms_id_trip_unique" UNIQUE("id","trip_id"),
	CONSTRAINT "trip_rooms_name_length" CHECK (char_length("trip_rooms"."name") between 1 and 60),
	CONSTRAINT "trip_rooms_sleeps" CHECK ("trip_rooms"."sleeps" between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "trip_rooms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_arrivals" ADD CONSTRAINT "trip_arrivals_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_arrivals" ADD CONSTRAINT "trip_arrivals_person_id_household_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."household_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_arrivals" ADD CONSTRAINT "trip_arrivals_guest_id_trip_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."trip_guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_arrivals" ADD CONSTRAINT "trip_arrivals_ride_user_id_profiles_id_fk" FOREIGN KEY ("ride_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_room_assignments" ADD CONSTRAINT "trip_room_assignments_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_room_assignments" ADD CONSTRAINT "trip_room_assignments_person_id_household_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."household_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_room_assignments" ADD CONSTRAINT "trip_room_assignments_guest_id_trip_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."trip_guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_room_assignments" ADD CONSTRAINT "trip_room_assignments_room_fk" FOREIGN KEY ("room_id","trip_id") REFERENCES "public"."trip_rooms"("id","trip_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_rooms" ADD CONSTRAINT "trip_rooms_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_arrivals_trip_idx" ON "trip_arrivals" USING btree ("trip_id","at");--> statement-breakpoint
CREATE INDEX "trip_arrivals_person_idx" ON "trip_arrivals" USING btree ("person_id") WHERE "trip_arrivals"."person_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_arrivals_guest_idx" ON "trip_arrivals" USING btree ("guest_id") WHERE "trip_arrivals"."guest_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_arrivals_ride_idx" ON "trip_arrivals" USING btree ("ride_user_id") WHERE "trip_arrivals"."ride_user_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_room_assignments_room_idx" ON "trip_room_assignments" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "trip_room_assignments_person_idx" ON "trip_room_assignments" USING btree ("person_id") WHERE "trip_room_assignments"."person_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_room_assignments_guest_idx" ON "trip_room_assignments" USING btree ("guest_id") WHERE "trip_room_assignments"."guest_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_rooms_trip_idx" ON "trip_rooms" USING btree ("trip_id","created_at");--> statement-breakpoint
-- Everyone on the trip sees who arrives when, and who sleeps where. Writes go through the data
-- access layer only.
CREATE POLICY "people on the trip read its arrivals" ON "trip_arrivals"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."can_see_trip"("trip_id"));--> statement-breakpoint
CREATE POLICY "people on the trip read its rooms" ON "trip_rooms"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."can_see_trip"("trip_id"));--> statement-breakpoint
CREATE POLICY "people on the trip read who sleeps where" ON "trip_room_assignments"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."can_see_trip"("trip_id"));
