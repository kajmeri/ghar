CREATE TYPE "public"."asset_kind" AS ENUM('vehicle', 'appliance', 'system', 'electronics', 'property', 'other');--> statement-breakpoint
CREATE TYPE "public"."bill_cadence" AS ENUM('monthly', 'quarterly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('insurance', 'warranty', 'tax', 'medical', 'legal', 'id', 'property', 'other');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "asset_kind" DEFAULT 'other' NOT NULL,
	"make" text,
	"model" text,
	"serial_number" text,
	"purchased_on" date,
	"purchase_price_cents" bigint,
	"warranty_expires_on" date,
	"location" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_name_length" CHECK (char_length("assets"."name") between 1 and 120),
	CONSTRAINT "assets_text_lengths" CHECK (char_length("assets"."make") <= 120
        and char_length("assets"."model") <= 120
        and char_length("assets"."serial_number") <= 120
        and char_length("assets"."location") <= 120
        and char_length("assets"."notes") <= 4000),
	CONSTRAINT "assets_purchase_price" CHECK ("assets"."purchase_price_cents" between 0 and 10000000000)
);
--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"payee" text NOT NULL,
	"amount_cents" bigint,
	"is_variable" boolean DEFAULT false NOT NULL,
	"cadence" "bill_cadence" DEFAULT 'monthly' NOT NULL,
	"due_day" smallint NOT NULL,
	"due_month" smallint,
	"autopay" boolean DEFAULT false NOT NULL,
	"account_id" uuid,
	"category_id" uuid,
	"url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_name_length" CHECK (char_length("bills"."name") between 1 and 120),
	CONSTRAINT "bills_payee_length" CHECK (char_length("bills"."payee") between 1 and 120),
	CONSTRAINT "bills_text_lengths" CHECK (char_length("bills"."url") <= 2000
        and char_length("bills"."notes") <= 4000),
	CONSTRAINT "bills_amount" CHECK ("bills"."amount_cents" between 1 and 100000000),
	CONSTRAINT "bills_due_day" CHECK ("bills"."due_day" between 1 and 31),
	CONSTRAINT "bills_due_month" CHECK (("bills"."cadence" = 'monthly' and "bills"."due_month" is null)
        or ("bills"."cadence" <> 'monthly' and "bills"."due_month" between 1 and 12))
);
--> statement-breakpoint
ALTER TABLE "bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"phone" text,
	"email" text,
	"url" text,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_name_length" CHECK (char_length("contacts"."name") between 1 and 120),
	CONSTRAINT "contacts_text_lengths" CHECK (char_length("contacts"."role") <= 80
        and char_length("contacts"."phone") <= 40
        and char_length("contacts"."email") <= 254
        and char_length("contacts"."url") <= 2000
        and char_length("contacts"."notes") <= 4000),
	CONSTRAINT "contacts_tags" CHECK (cardinality("contacts"."tags") <= 12
        and char_length(array_to_string("contacts"."tags", '')) <= 384)
);
--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "document_kind" DEFAULT 'other' NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"issued_on" date,
	"expires_on" date,
	"issuer" text,
	"reference_number" text,
	"asset_id" uuid,
	"notes" text,
	"uploaded_by" uuid,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_storage_path_unique" UNIQUE("storage_path"),
	CONSTRAINT "documents_title_length" CHECK (char_length("documents"."title") between 1 and 200),
	CONSTRAINT "documents_text_lengths" CHECK (char_length("documents"."issuer") <= 200
        and char_length("documents"."reference_number") <= 200
        and char_length("documents"."notes") <= 4000),
	CONSTRAINT "documents_mime_type" CHECK ("documents"."mime_type" in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')),
	CONSTRAINT "documents_size" CHECK ("documents"."size_bytes" between 1 and 20971520),
	CONSTRAINT "documents_storage_path_household" CHECK (split_part("documents"."storage_path", '/', 1) = "documents"."household_id"::text),
	CONSTRAINT "documents_expires_after_issued" CHECK ("documents"."expires_on" >= "documents"."issued_on")
);
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expiry_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"document_id" uuid,
	"asset_id" uuid,
	"threshold_days" smallint NOT NULL,
	"expires_on" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expiry_reminders_one_subject" CHECK (num_nonnulls("expiry_reminders"."document_id", "expiry_reminders"."asset_id") = 1),
	CONSTRAINT "expiry_reminders_threshold" CHECK ("expiry_reminders"."threshold_days" in (60, 30, 7))
);
--> statement-breakpoint
ALTER TABLE "expiry_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "maintenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"asset_id" uuid,
	"title" text NOT NULL,
	"cadence_months" smallint,
	"cadence_miles" integer,
	"last_done_on" date,
	"next_due_on" date,
	"assigned_user_id" uuid,
	"instructions" text,
	"vendor_contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_title_length" CHECK (char_length("maintenance"."title") between 1 and 120),
	CONSTRAINT "maintenance_instructions_length" CHECK (char_length("maintenance"."instructions") <= 4000),
	CONSTRAINT "maintenance_cadence_months" CHECK ("maintenance"."cadence_months" between 1 and 120),
	CONSTRAINT "maintenance_cadence_miles" CHECK ("maintenance"."cadence_miles" between 1 and 500000)
);
--> statement-breakpoint
ALTER TABLE "maintenance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "maintenance_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"maintenance_id" uuid NOT NULL,
	"completed_on" date NOT NULL,
	"completed_by" uuid,
	"cost_cents" bigint,
	"notes" text,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_log_cost" CHECK ("maintenance_log"."cost_cents" between 0 and 100000000),
	CONSTRAINT "maintenance_log_notes_length" CHECK (char_length("maintenance_log"."notes") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "maintenance_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_reminders" ADD CONSTRAINT "expiry_reminders_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_reminders" ADD CONSTRAINT "expiry_reminders_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_reminders" ADD CONSTRAINT "expiry_reminders_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_assigned_user_id_profiles_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_vendor_contact_id_contacts_id_fk" FOREIGN KEY ("vendor_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_log" ADD CONSTRAINT "maintenance_log_maintenance_id_maintenance_id_fk" FOREIGN KEY ("maintenance_id") REFERENCES "public"."maintenance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_log" ADD CONSTRAINT "maintenance_log_completed_by_profiles_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_log" ADD CONSTRAINT "maintenance_log_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_household_name_idx" ON "assets" USING btree ("household_id",lower("name"));--> statement-breakpoint
CREATE INDEX "assets_household_warranty_idx" ON "assets" USING btree ("household_id","warranty_expires_on") WHERE "assets"."warranty_expires_on" is not null;--> statement-breakpoint
CREATE INDEX "bills_household_idx" ON "bills" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "contacts_household_name_idx" ON "contacts" USING btree ("household_id",lower("name"));--> statement-breakpoint
CREATE INDEX "documents_household_created_idx" ON "documents" USING btree ("household_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "documents_household_expires_idx" ON "documents" USING btree ("household_id","expires_on") WHERE "documents"."expires_on" is not null;--> statement-breakpoint
CREATE INDEX "documents_asset_idx" ON "documents" USING btree ("asset_id") WHERE "documents"."asset_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "expiry_reminders_document_unique" ON "expiry_reminders" USING btree ("document_id","threshold_days","expires_on") WHERE "expiry_reminders"."document_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "expiry_reminders_asset_unique" ON "expiry_reminders" USING btree ("asset_id","threshold_days","expires_on") WHERE "expiry_reminders"."asset_id" is not null;--> statement-breakpoint
CREATE INDEX "maintenance_household_due_idx" ON "maintenance" USING btree ("household_id","next_due_on");--> statement-breakpoint
CREATE INDEX "maintenance_asset_idx" ON "maintenance" USING btree ("asset_id") WHERE "maintenance"."asset_id" is not null;--> statement-breakpoint
CREATE INDEX "maintenance_vendor_idx" ON "maintenance" USING btree ("vendor_contact_id") WHERE "maintenance"."vendor_contact_id" is not null;--> statement-breakpoint
CREATE INDEX "maintenance_log_task_completed_idx" ON "maintenance_log" USING btree ("maintenance_id","completed_on" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "members read their household's contacts" ON "contacts"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IS NOT NULL);--> statement-breakpoint
CREATE POLICY "members read their household's assets" ON "assets"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IS NOT NULL);--> statement-breakpoint
CREATE POLICY "members read their household's maintenance" ON "maintenance"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IS NOT NULL);--> statement-breakpoint
CREATE POLICY "members read their household's maintenance log" ON "maintenance_log"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "public"."maintenance" m
    WHERE m.id = "maintenance_log"."maintenance_id"
      AND "private"."member_role"(m.household_id) IS NOT NULL
  ));--> statement-breakpoint
CREATE POLICY "members read their household's bills" ON "bills"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IN ('owner', 'adult'));--> statement-breakpoint
-- Sensitive documents (passports, medical records) are for owners and adults only.
CREATE POLICY "members read their household's documents" ON "documents"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    "private"."member_role"("household_id") IS NOT NULL
    AND (NOT "is_sensitive" OR "private"."member_role"("household_id") IN ('owner', 'adult'))
  );--> statement-breakpoint
-- expiry_reminders has no policy: only the reminder job reads or writes it.
-- The private bucket that holds document files. No storage.objects policies, on purpose: nothing
-- but the server's secret key reaches it, and people only ever get short-lived signed URLs.
-- Guarded so the migration still runs on a database without Supabase Storage (tests, plain Postgres).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'documents',
      'documents',
      false,
      20971520,
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
    )
    ON CONFLICT (id) DO UPDATE SET public = false;
  END IF;
END
$$;