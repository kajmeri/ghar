CREATE TABLE "trip_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"caption" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_photos_storage_path_unique" UNIQUE("storage_path"),
	CONSTRAINT "trip_photos_caption_length" CHECK (char_length("trip_photos"."caption") between 1 and 140),
	CONSTRAINT "trip_photos_mime_type" CHECK ("trip_photos"."mime_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "trip_photos_size" CHECK ("trip_photos"."size_bytes" between 1 and 10485760),
	CONSTRAINT "trip_photos_storage_path_trip" CHECK (split_part("trip_photos"."storage_path", '/', 1) = 'trip-photos' and split_part("trip_photos"."storage_path", '/', 2) = "trip_photos"."trip_id"::text)
);
--> statement-breakpoint
ALTER TABLE "trip_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_recap_emails" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_recap_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_added_by_profiles_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_recap_emails" ADD CONSTRAINT "trip_recap_emails_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_photos_trip_idx" ON "trip_photos" USING btree ("trip_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trip_photos_added_by_idx" ON "trip_photos" USING btree ("added_by") WHERE "trip_photos"."added_by" is not null;--> statement-breakpoint
CREATE POLICY "people on the trip see its photos" ON "trip_photos"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."can_see_trip"("trip_id"));
