CREATE TYPE "public"."attendee_response" AS ENUM('needs_action', 'accepted', 'tentative', 'declined');--> statement-breakpoint
CREATE TYPE "public"."calendar_link_direction" AS ENUM('inbound', 'two_way');--> statement-breakpoint
CREATE TYPE "public"."calendar_link_status" AS ENUM('active', 'needs_reconnect', 'error');--> statement-breakpoint
CREATE TYPE "public"."calendar_provider" AS ENUM('google');--> statement-breakpoint
CREATE TYPE "public"."event_category" AS ENUM('household', 'school', 'travel', 'bill', 'maintenance', 'personal');--> statement-breakpoint
CREATE TABLE "calendar_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "calendar_provider" NOT NULL,
	"account_email" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"calendar_id" text NOT NULL,
	"sync_token" text,
	"direction" "calendar_link_direction" DEFAULT 'inbound' NOT NULL,
	"status" "calendar_link_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_links_user_calendar_unique" UNIQUE("user_id","provider","calendar_id"),
	CONSTRAINT "calendar_links_last_error_length" CHECK (char_length("calendar_links"."last_error") <= 500)
);
--> statement-breakpoint
ALTER TABLE "calendar_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_attendees" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"response" "attendee_response" DEFAULT 'needs_action' NOT NULL,
	CONSTRAINT "event_attendees_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "event_attendees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"rrule" text,
	"category" "event_category" DEFAULT 'household' NOT NULL,
	"color_token" text,
	"created_by" uuid,
	"external_source" "calendar_provider",
	"external_id" text,
	"external_calendar_id" text,
	"calendar_link_id" uuid,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_title_length" CHECK (char_length("events"."title") between 1 and 200),
	CONSTRAINT "events_text_lengths" CHECK (char_length("events"."description") <= 8000
        and char_length("events"."location") <= 500),
	CONSTRAINT "events_ends_after_starts" CHECK ("events"."ends_at" >= "events"."starts_at"),
	CONSTRAINT "events_all_day_whole_days" CHECK (not "events"."all_day" or (
        "events"."ends_at" > "events"."starts_at"
        and ("events"."starts_at" at time zone 'UTC')::time = '00:00'
        and ("events"."ends_at" at time zone 'UTC')::time = '00:00'
      )),
	CONSTRAINT "events_color_token" CHECK ("events"."color_token" in ('positive', 'caution', 'negative')),
	CONSTRAINT "events_external_shape" CHECK ((
        "events"."external_source" is null and "events"."external_id" is null
        and "events"."external_calendar_id" is null and "events"."calendar_link_id" is null
        and "events"."last_synced_at" is null
      ) or (
        "events"."external_source" is not null and "events"."external_id" is not null
        and "events"."external_calendar_id" is not null and "events"."calendar_link_id" is not null
        and "events"."last_synced_at" is not null and "events"."rrule" is null
      ))
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_links" ADD CONSTRAINT "calendar_links_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_links" ADD CONSTRAINT "calendar_links_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_links" ADD CONSTRAINT "calendar_links_membership_fk" FOREIGN KEY ("household_id","user_id") REFERENCES "public"."household_members"("household_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_calendar_link_id_calendar_links_id_fk" FOREIGN KEY ("calendar_link_id") REFERENCES "public"."calendar_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_links_household_idx" ON "calendar_links" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "event_attendees_user_idx" ON "event_attendees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_household_starts_idx" ON "events" USING btree ("household_id","starts_at");--> statement-breakpoint
CREATE INDEX "events_household_recurring_idx" ON "events" USING btree ("household_id") WHERE "events"."rrule" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "events_link_external_unique" ON "events" USING btree ("calendar_link_id","external_id") WHERE "events"."external_id" is not null;--> statement-breakpoint
-- calendar_links has no policy on purpose: it holds refresh tokens, so API roles can't read it.
CREATE POLICY "members read their household's events" ON "events"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IS NOT NULL);--> statement-breakpoint
CREATE POLICY "members read their household's event attendees" ON "event_attendees"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM "public"."events" e WHERE e.id = "event_attendees"."event_id" AND "private"."member_role"(e.household_id) IS NOT NULL));