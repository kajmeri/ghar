CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid,
	"access_token_hash" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_access_token_hash_unique" UNIQUE("access_token_hash"),
	CONSTRAINT "api_tokens_refresh_token_hash_unique" UNIQUE("refresh_token_hash"),
	CONSTRAINT "api_tokens_expiry" CHECK ("api_tokens"."access_expires_at" > "api_tokens"."created_at" and "api_tokens"."refresh_expires_at" >= "api_tokens"."access_expires_at")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_tombstones" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_tombstones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"user_id" uuid,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "sync_tombstones_entity" CHECK ("sync_tombstones"."entity" in ('household', 'member', 'invitation', 'account', 'category', 'transaction', 'bill', 'bill_payment', 'trip', 'booking', 'itinerary_slot', 'trip_idea', 'packing_item', 'packing_template', 'calendar_link', 'event', 'contact', 'asset', 'document', 'maintenance', 'maintenance_log', 'booking_draft', 'digest_preferences'))
);
--> statement-breakpoint
ALTER TABLE "sync_tombstones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "action_tokens_household_idx";--> statement-breakpoint
DROP INDEX "bill_payments_household_idx";--> statement-breakpoint
DROP INDEX "bills_household_idx";--> statement-breakpoint
DROP INDEX "bookings_household_idx";--> statement-breakpoint
DROP INDEX "calendar_links_household_idx";--> statement-breakpoint
DROP INDEX "mail_links_household_idx";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_drafts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "household_members" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_log" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_membership_fk" FOREIGN KEY ("household_id","user_id") REFERENCES "public"."household_members"("household_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_tombstones" ADD CONSTRAINT "sync_tombstones_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_family_idx" ON "api_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_tokens_membership_idx" ON "api_tokens" USING btree ("household_id","user_id") WHERE "api_tokens"."household_id" is not null;--> statement-breakpoint
CREATE INDEX "sync_tombstones_household_deleted_idx" ON "sync_tombstones" USING btree ("household_id","deleted_at","id");--> statement-breakpoint
CREATE INDEX "action_tokens_membership_idx" ON "action_tokens" USING btree ("household_id","user_id");--> statement-breakpoint
CREATE INDEX "action_tokens_user_idx" ON "action_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id") WHERE "audit_log"."actor_user_id" is not null;--> statement-breakpoint
CREATE INDEX "bill_payments_household_bill_due_idx" ON "bill_payments" USING btree ("household_id","bill_id","due_on");--> statement-breakpoint
CREATE INDEX "bill_payments_marked_by_idx" ON "bill_payments" USING btree ("marked_by") WHERE "bill_payments"."marked_by" is not null;--> statement-breakpoint
CREATE INDEX "bills_household_name_idx" ON "bills" USING btree ("household_id",lower("name"),"id");--> statement-breakpoint
CREATE INDEX "bills_account_idx" ON "bills" USING btree ("account_id") WHERE "bills"."account_id" is not null;--> statement-breakpoint
CREATE INDEX "bills_category_idx" ON "bills" USING btree ("category_id") WHERE "bills"."category_id" is not null;--> statement-breakpoint
CREATE INDEX "booking_drafts_membership_idx" ON "booking_drafts" USING btree ("household_id","user_id");--> statement-breakpoint
CREATE INDEX "booking_drafts_booking_idx" ON "booking_drafts" USING btree ("booking_id") WHERE "booking_drafts"."booking_id" is not null;--> statement-breakpoint
CREATE INDEX "bookings_trip_idx" ON "bookings" USING btree ("trip_id") WHERE "bookings"."trip_id" is not null;--> statement-breakpoint
CREATE INDEX "bookings_created_by_idx" ON "bookings" USING btree ("created_by") WHERE "bookings"."created_by" is not null;--> statement-breakpoint
CREATE INDEX "calendar_links_membership_idx" ON "calendar_links" USING btree ("household_id","user_id");--> statement-breakpoint
CREATE INDEX "category_rules_created_by_idx" ON "category_rules" USING btree ("created_by_user_id") WHERE "category_rules"."created_by_user_id" is not null;--> statement-breakpoint
CREATE INDEX "digest_preferences_user_idx" ON "digest_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "digest_sends_user_idx" ON "digest_sends" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "documents_uploaded_by_idx" ON "documents" USING btree ("uploaded_by") WHERE "documents"."uploaded_by" is not null;--> statement-breakpoint
CREATE INDEX "events_household_ends_idx" ON "events" USING btree ("household_id","ends_at");--> statement-breakpoint
CREATE INDEX "events_calendar_link_idx" ON "events" USING btree ("calendar_link_id") WHERE "events"."calendar_link_id" is not null;--> statement-breakpoint
CREATE INDEX "events_created_by_idx" ON "events" USING btree ("created_by") WHERE "events"."created_by" is not null;--> statement-breakpoint
CREATE INDEX "expiry_reminders_household_idx" ON "expiry_reminders" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "goals_linked_account_idx" ON "goals" USING btree ("linked_account_id") WHERE "goals"."linked_account_id" is not null;--> statement-breakpoint
CREATE INDEX "invitations_household_idx" ON "invitations" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "invitations_invited_by_idx" ON "invitations" USING btree ("invited_by") WHERE "invitations"."invited_by" is not null;--> statement-breakpoint
CREATE INDEX "itinerary_options_created_by_idx" ON "itinerary_options" USING btree ("created_by_user_id") WHERE "itinerary_options"."created_by_user_id" is not null;--> statement-breakpoint
CREATE INDEX "itinerary_slots_chosen_option_idx" ON "itinerary_slots" USING btree ("chosen_option_id") WHERE "itinerary_slots"."chosen_option_id" is not null;--> statement-breakpoint
CREATE INDEX "mail_links_membership_idx" ON "mail_links" USING btree ("household_id","user_id");--> statement-breakpoint
CREATE INDEX "mail_messages_membership_idx" ON "mail_messages" USING btree ("household_id","user_id");--> statement-breakpoint
CREATE INDEX "maintenance_assigned_user_idx" ON "maintenance" USING btree ("assigned_user_id") WHERE "maintenance"."assigned_user_id" is not null;--> statement-breakpoint
CREATE INDEX "maintenance_log_completed_by_idx" ON "maintenance_log" USING btree ("completed_by") WHERE "maintenance_log"."completed_by" is not null;--> statement-breakpoint
CREATE INDEX "maintenance_log_document_idx" ON "maintenance_log" USING btree ("document_id") WHERE "maintenance_log"."document_id" is not null;--> statement-breakpoint
CREATE INDEX "packing_items_assigned_user_idx" ON "packing_items" USING btree ("assigned_user_id") WHERE "packing_items"."assigned_user_id" is not null;--> statement-breakpoint
CREATE INDEX "transaction_edits_user_idx" ON "transaction_edits" USING btree ("user_id") WHERE "transaction_edits"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_category_idx" ON "transactions" USING btree ("category_id") WHERE "transactions"."category_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_category_rule_idx" ON "transactions" USING btree ("category_rule_id") WHERE "transactions"."category_rule_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_suggested_category_idx" ON "transactions" USING btree ("suggested_category_id") WHERE "transactions"."suggested_category_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_ideas_created_by_idx" ON "trip_ideas" USING btree ("created_by_user_id") WHERE "trip_ideas"."created_by_user_id" is not null;--> statement-breakpoint
CREATE INDEX "trips_household_ends_idx" ON "trips" USING btree ("household_id","ends_on");--> statement-breakpoint
-- Delta sync. GET /api/v1/sync reads rows changed since a cursor, so three things must hold without app
-- code remembering them:
--   1. updated_at moves on insert and on any update that changes the row (set_updated_at).
--   2. A change to a child a client only sees inside its parent (a vote inside an itinerary slot) moves
--      the parent's updated_at (touch_parent).
--   3. Deleting a row a client can hold leaves a tombstone (record_tombstone). A row deleted because its
--      household or its parent went leaves none: the client drops children with their parent.
-- clock_timestamp(), not now(): now() is the transaction start, so a long transaction could commit rows
-- stamped earlier than a cursor already handed out. The endpoint also rereads a 60 second overlap.
-- None of these are SECURITY DEFINER: every RLS policy is SELECT-only, so only the server writes. A
-- future write policy has to add one to sync_tombstones too, or deletes under it fail loudly.
CREATE FUNCTION "private"."set_updated_at"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- *<> compares the stored bytes, so it works for every column type and ignores no-op upserts.
  IF TG_OP = 'INSERT' OR NEW *<> OLD THEN
    NEW.updated_at := clock_timestamp();
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
-- Arguments: parent table, parent key column, the child's column holding that key.
CREATE FUNCTION "private"."touch_parent"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  parent_ids uuid[] := '{}';
BEGIN
  IF TG_OP = 'UPDATE' AND NEW *= OLD THEN
    RETURN NULL;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    parent_ids := array_append(parent_ids, (to_jsonb(NEW) ->> TG_ARGV[2])::uuid);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    parent_ids := array_append(parent_ids, (to_jsonb(OLD) ->> TG_ARGV[2])::uuid);
  END IF;
  EXECUTE format('UPDATE public.%I SET updated_at = clock_timestamp() WHERE %I = ANY ($1)', TG_ARGV[0], TG_ARGV[1])
    USING parent_ids;
  RETURN NULL;
END
$$;--> statement-breakpoint
-- Arguments: sync entity, the column holding its id, the column holding whose it is ('' when the whole
-- household sees it), and for a table with no household_id, the parent table and the column pointing at it.
CREATE FUNCTION "private"."record_tombstone"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD);
  household uuid;
BEGIN
  IF TG_NARGS > 3 THEN
    EXECUTE format('SELECT household_id FROM public.%I WHERE id = $1', TG_ARGV[3])
      INTO household
      USING (old_row ->> TG_ARGV[4])::uuid;
  ELSE
    household := (old_row ->> 'household_id')::uuid;
  END IF;
  -- No household: the parent is gone. No household row: the household is being deleted.
  IF household IS NULL OR NOT EXISTS (SELECT 1 FROM public.households WHERE id = household) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.sync_tombstones (household_id, user_id, entity, entity_id)
  VALUES (
    household,
    CASE WHEN TG_ARGV[2] = '' THEN NULL ELSE (old_row ->> TG_ARGV[2])::uuid END,
    TG_ARGV[0],
    (old_row ->> TG_ARGV[1])::uuid
  );
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "households_set_updated_at" BEFORE INSERT OR UPDATE ON "households" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "household_members_set_updated_at" BEFORE INSERT OR UPDATE ON "household_members" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "invitations_set_updated_at" BEFORE INSERT OR UPDATE ON "invitations" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "accounts_set_updated_at" BEFORE INSERT OR UPDATE ON "accounts" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "categories_set_updated_at" BEFORE INSERT OR UPDATE ON "categories" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "transactions_set_updated_at" BEFORE INSERT OR UPDATE ON "transactions" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "bills_set_updated_at" BEFORE INSERT OR UPDATE ON "bills" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "bill_payments_set_updated_at" BEFORE INSERT OR UPDATE ON "bill_payments" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "bookings_set_updated_at" BEFORE INSERT OR UPDATE ON "bookings" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "trips_set_updated_at" BEFORE INSERT OR UPDATE ON "trips" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "itinerary_slots_set_updated_at" BEFORE INSERT OR UPDATE ON "itinerary_slots" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "itinerary_options_set_updated_at" BEFORE INSERT OR UPDATE ON "itinerary_options" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "option_votes_set_updated_at" BEFORE INSERT OR UPDATE ON "option_votes" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "trip_ideas_set_updated_at" BEFORE INSERT OR UPDATE ON "trip_ideas" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "packing_items_set_updated_at" BEFORE INSERT OR UPDATE ON "packing_items" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "packing_templates_set_updated_at" BEFORE INSERT OR UPDATE ON "packing_templates" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "calendar_links_set_updated_at" BEFORE INSERT OR UPDATE ON "calendar_links" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "events_set_updated_at" BEFORE INSERT OR UPDATE ON "events" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "contacts_set_updated_at" BEFORE INSERT OR UPDATE ON "contacts" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "assets_set_updated_at" BEFORE INSERT OR UPDATE ON "assets" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "documents_set_updated_at" BEFORE INSERT OR UPDATE ON "documents" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "maintenance_set_updated_at" BEFORE INSERT OR UPDATE ON "maintenance" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "maintenance_log_set_updated_at" BEFORE INSERT OR UPDATE ON "maintenance_log" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "mail_links_set_updated_at" BEFORE INSERT OR UPDATE ON "mail_links" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "booking_drafts_set_updated_at" BEFORE INSERT OR UPDATE ON "booking_drafts" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "digest_preferences_set_updated_at" BEFORE INSERT OR UPDATE ON "digest_preferences" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "trip_members_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "trip_members" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('trips', 'id', 'trip_id');--> statement-breakpoint
CREATE TRIGGER "itinerary_scaffold_dismissals_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "itinerary_scaffold_dismissals" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('trips', 'id', 'trip_id');--> statement-breakpoint
CREATE TRIGGER "itinerary_options_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "itinerary_options" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('itinerary_slots', 'id', 'slot_id');--> statement-breakpoint
CREATE TRIGGER "option_votes_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "option_votes" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('itinerary_options', 'id', 'option_id');--> statement-breakpoint
CREATE TRIGGER "event_attendees_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "event_attendees" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('events', 'id', 'event_id');--> statement-breakpoint
CREATE TRIGGER "packing_template_items_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "packing_template_items" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('packing_templates', 'id', 'template_id');--> statement-breakpoint
CREATE TRIGGER "price_checks_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "price_checks" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('bookings', 'id', 'booking_id');--> statement-breakpoint
CREATE TRIGGER "price_alerts_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "price_alerts" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('bookings', 'id', 'booking_id');--> statement-breakpoint
-- A member row carries the person's name, which lives on profiles.
CREATE TRIGGER "profiles_touch_parent" AFTER UPDATE ON "profiles" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('household_members', 'user_id', 'id');--> statement-breakpoint
CREATE TRIGGER "household_members_record_tombstone" AFTER DELETE ON "household_members" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('member', 'user_id', '');--> statement-breakpoint
CREATE TRIGGER "invitations_record_tombstone" AFTER DELETE ON "invitations" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('invitation', 'id', '');--> statement-breakpoint
CREATE TRIGGER "accounts_record_tombstone" AFTER DELETE ON "accounts" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('account', 'id', '');--> statement-breakpoint
CREATE TRIGGER "categories_record_tombstone" AFTER DELETE ON "categories" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('category', 'id', '');--> statement-breakpoint
CREATE TRIGGER "transactions_record_tombstone" AFTER DELETE ON "transactions" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('transaction', 'id', '');--> statement-breakpoint
CREATE TRIGGER "bills_record_tombstone" AFTER DELETE ON "bills" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('bill', 'id', '');--> statement-breakpoint
CREATE TRIGGER "bill_payments_record_tombstone" AFTER DELETE ON "bill_payments" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('bill_payment', 'id', '');--> statement-breakpoint
CREATE TRIGGER "trips_record_tombstone" AFTER DELETE ON "trips" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('trip', 'id', '');--> statement-breakpoint
CREATE TRIGGER "bookings_record_tombstone" AFTER DELETE ON "bookings" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('booking', 'id', '');--> statement-breakpoint
CREATE TRIGGER "trip_ideas_record_tombstone" AFTER DELETE ON "trip_ideas" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('trip_idea', 'id', '');--> statement-breakpoint
CREATE TRIGGER "packing_templates_record_tombstone" AFTER DELETE ON "packing_templates" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('packing_template', 'id', '');--> statement-breakpoint
CREATE TRIGGER "calendar_links_record_tombstone" AFTER DELETE ON "calendar_links" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('calendar_link', 'id', '');--> statement-breakpoint
CREATE TRIGGER "events_record_tombstone" AFTER DELETE ON "events" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('event', 'id', '');--> statement-breakpoint
CREATE TRIGGER "contacts_record_tombstone" AFTER DELETE ON "contacts" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('contact', 'id', '');--> statement-breakpoint
CREATE TRIGGER "assets_record_tombstone" AFTER DELETE ON "assets" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('asset', 'id', '');--> statement-breakpoint
CREATE TRIGGER "documents_record_tombstone" AFTER DELETE ON "documents" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('document', 'id', '');--> statement-breakpoint
CREATE TRIGGER "maintenance_record_tombstone" AFTER DELETE ON "maintenance" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('maintenance', 'id', '');--> statement-breakpoint
CREATE TRIGGER "itinerary_slots_record_tombstone" AFTER DELETE ON "itinerary_slots" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('itinerary_slot', 'id', '', 'trips', 'trip_id');--> statement-breakpoint
CREATE TRIGGER "packing_items_record_tombstone" AFTER DELETE ON "packing_items" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('packing_item', 'id', '', 'trips', 'trip_id');--> statement-breakpoint
CREATE TRIGGER "maintenance_log_record_tombstone" AFTER DELETE ON "maintenance_log" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('maintenance_log', 'id', '', 'maintenance', 'maintenance_id');--> statement-breakpoint
CREATE TRIGGER "booking_drafts_record_tombstone" AFTER DELETE ON "booking_drafts" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('booking_draft', 'id', 'user_id');--> statement-breakpoint
-- sync_tombstones has no policy: only the sync endpoint reads it.
-- api_tokens has no policy: it holds token hashes, and only the server reads it.
CREATE TRIGGER "digest_preferences_record_tombstone" AFTER DELETE ON "digest_preferences" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('digest_preferences', 'user_id', 'user_id');