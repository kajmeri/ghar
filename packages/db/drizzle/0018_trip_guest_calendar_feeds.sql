CREATE TABLE "trip_guest_calendar_feeds" (
	"guest_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"token_sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_guest_calendar_feeds_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "trip_guest_calendar_feeds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_guest_calendar_feeds" ADD CONSTRAINT "trip_guest_calendar_feeds_guest_id_trip_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."trip_guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER "trip_guest_calendar_feeds_set_updated_at" BEFORE INSERT OR UPDATE ON "trip_guest_calendar_feeds" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();
-- No policy on purpose, like trip_share_links: it holds a sealed token, so API roles can't read it.
