CREATE TYPE "public"."booking_draft_status" AS ENUM('pending', 'confirmed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."mail_link_status" AS ENUM('active', 'needs_reconnect');--> statement-breakpoint
CREATE TYPE "public"."mail_message_outcome" AS ENUM('draft', 'not_booking', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."one_tap_action" AS ENUM('categorize_transaction', 'mark_bill_paid');--> statement-breakpoint
CREATE TABLE "action_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" "one_tap_action" NOT NULL,
	"entity_id" uuid NOT NULL,
	"due_on" date,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_tokens_expiry" CHECK ("action_tokens"."expires_at" > "action_tokens"."created_at"),
	CONSTRAINT "action_tokens_due_on" CHECK (("action_tokens"."action" = 'mark_bill_paid') = ("action_tokens"."due_on" is not null))
);
--> statement-breakpoint
ALTER TABLE "action_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bill_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"paid_on" date NOT NULL,
	"marked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_payments_bill_due_unique" UNIQUE("bill_id","due_on")
);
--> statement-breakpoint
ALTER TABLE "bill_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "booking_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"sender_domain" text NOT NULL,
	"subject" text NOT NULL,
	"raw_extract" jsonb NOT NULL,
	"status" "booking_draft_status" DEFAULT 'pending' NOT NULL,
	"booking_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_drafts_user_message_unique" UNIQUE("user_id","message_id"),
	CONSTRAINT "booking_drafts_text_lengths" CHECK (char_length("booking_drafts"."subject") <= 200
        and char_length("booking_drafts"."sender_domain") <= 253),
	CONSTRAINT "booking_drafts_reviewed" CHECK (("booking_drafts"."status" = 'pending') = ("booking_drafts"."reviewed_at" is null)),
	CONSTRAINT "booking_drafts_confirmed_booking" CHECK ("booking_drafts"."status" = 'confirmed' or "booking_drafts"."booking_id" is null)
);
--> statement-breakpoint
ALTER TABLE "booking_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "digest_preferences" (
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sections" text[] NOT NULL,
	"send_hour" smallint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_preferences_pk" PRIMARY KEY("household_id","user_id"),
	CONSTRAINT "digest_preferences_sections" CHECK ("digest_preferences"."sections" <@ array['auto_categorized', 'needs_review', 'budget', 'bills', 'upkeep', 'price_drops', 'calendar']::text[]),
	CONSTRAINT "digest_preferences_send_hour" CHECK ("digest_preferences"."send_hour" between 0 and 23)
);
--> statement-breakpoint
ALTER TABLE "digest_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "digest_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"digest_on" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_sends_user_day_unique" UNIQUE("household_id","user_id","digest_on")
);
--> statement-breakpoint
ALTER TABLE "digest_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mail_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"account_email" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"status" "mail_link_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_links_user_unique" UNIQUE("user_id"),
	CONSTRAINT "mail_links_last_error_length" CHECK (char_length("mail_links"."last_error") <= 500)
);
--> statement-breakpoint
ALTER TABLE "mail_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"outcome" "mail_message_outcome" NOT NULL,
	"attempts" smallint DEFAULT 1 NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_messages_user_message_unique" UNIQUE("user_id","message_id"),
	CONSTRAINT "mail_messages_attempts" CHECK ("mail_messages"."attempts" >= 1)
);
--> statement-breakpoint
ALTER TABLE "mail_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_membership_fk" FOREIGN KEY ("household_id","user_id") REFERENCES "public"."household_members"("household_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_marked_by_profiles_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_drafts" ADD CONSTRAINT "booking_drafts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_drafts" ADD CONSTRAINT "booking_drafts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_drafts" ADD CONSTRAINT "booking_drafts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_drafts" ADD CONSTRAINT "booking_drafts_membership_fk" FOREIGN KEY ("household_id","user_id") REFERENCES "public"."household_members"("household_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_preferences" ADD CONSTRAINT "digest_preferences_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_preferences" ADD CONSTRAINT "digest_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_preferences" ADD CONSTRAINT "digest_preferences_membership_fk" FOREIGN KEY ("household_id","user_id") REFERENCES "public"."household_members"("household_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_sends" ADD CONSTRAINT "digest_sends_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_sends" ADD CONSTRAINT "digest_sends_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_sends" ADD CONSTRAINT "digest_sends_membership_fk" FOREIGN KEY ("household_id","user_id") REFERENCES "public"."household_members"("household_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_links" ADD CONSTRAINT "mail_links_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_links" ADD CONSTRAINT "mail_links_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_links" ADD CONSTRAINT "mail_links_membership_fk" FOREIGN KEY ("household_id","user_id") REFERENCES "public"."household_members"("household_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_membership_fk" FOREIGN KEY ("household_id","user_id") REFERENCES "public"."household_members"("household_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_tokens_household_idx" ON "action_tokens" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "action_tokens_expires_idx" ON "action_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "bill_payments_household_idx" ON "bill_payments" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "booking_drafts_pending_idx" ON "booking_drafts" USING btree ("household_id","user_id","received_at") WHERE "booking_drafts"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "mail_links_household_idx" ON "mail_links" USING btree ("household_id");--> statement-breakpoint
CREATE POLICY "owners and adults read their household's bill payments" ON "bill_payments"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IN ('owner', 'adult'));--> statement-breakpoint
-- A draft came from one person's inbox, so only that person reads it, and only while in the household.
CREATE POLICY "people read drafts from their own inbox" ON "booking_drafts"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("user_id" = (SELECT auth.uid()) AND "private"."member_role"("household_id") IS NOT NULL);--> statement-breakpoint
CREATE POLICY "people read their own digest preferences" ON "digest_preferences"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("user_id" = (SELECT auth.uid()) AND "private"."member_role"("household_id") IS NOT NULL);
-- mail_links has no policy: it holds refresh tokens, and only the server reads it.
-- mail_messages has no policy: only the mail check reads or writes it.
-- digest_sends has no policy: only the digest job reads or writes it.
-- action_tokens has no policy: only the server creates and redeems one-tap links.
