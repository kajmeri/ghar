CREATE TABLE "account_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid,
	"manual_account_id" uuid,
	"as_of" date NOT NULL,
	"balance_cents" bigint NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_snapshots_account_as_of_unique" UNIQUE("account_id","as_of"),
	CONSTRAINT "account_snapshots_manual_account_as_of_unique" UNIQUE("manual_account_id","as_of"),
	CONSTRAINT "account_snapshots_one_account" CHECK (num_nonnulls("account_snapshots"."account_id", "account_snapshots"."manual_account_id") = 1),
	CONSTRAINT "account_snapshots_source" CHECK (("account_snapshots"."source" = 'plaid' and "account_snapshots"."account_id" is not null) or ("account_snapshots"."source" = 'manual' and "account_snapshots"."manual_account_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "account_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"plaid_security_id" text NOT NULL,
	"ticker" text,
	"name" text,
	"security_type" text,
	"quantity" numeric NOT NULL,
	"cost_basis_cents" bigint,
	"value_cents" bigint NOT NULL,
	"as_of" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holdings_account_security_unique" UNIQUE("account_id","plaid_security_id")
);
--> statement-breakpoint
ALTER TABLE "holdings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "liability_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"apr_percent" numeric,
	"minimum_payment_cents" bigint,
	"next_payment_due_on" date,
	"last_payment_cents" bigint,
	"last_payment_on" date,
	"origination_date" date,
	"original_principal_cents" bigint,
	"is_overdue" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "liability_details_account_unique" UNIQUE("account_id"),
	CONSTRAINT "liability_details_kind" CHECK ("liability_details"."kind" in ('credit', 'student', 'mortgage')),
	CONSTRAINT "liability_details_apr" CHECK ("liability_details"."apr_percent" between 0 and 100),
	CONSTRAINT "liability_details_amounts" CHECK ("liability_details"."minimum_payment_cents" >= 0 and "liability_details"."last_payment_cents" >= 0 and "liability_details"."original_principal_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "liability_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "manual_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_liability" boolean NOT NULL,
	"notes" text,
	"reminder_cadence_months" smallint,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_accounts_kind" CHECK ("manual_accounts"."kind" in ('property', 'vehicle', 'retirement', 'crypto', 'cash', 'other_asset', 'loan', 'other_liability')),
	CONSTRAINT "manual_accounts_is_liability" CHECK ("manual_accounts"."is_liability" = ("manual_accounts"."kind" in ('loan', 'other_liability'))),
	CONSTRAINT "manual_accounts_name_length" CHECK (char_length("manual_accounts"."name") between 1 and 80),
	CONSTRAINT "manual_accounts_notes_length" CHECK (char_length("manual_accounts"."notes") <= 500),
	CONSTRAINT "manual_accounts_reminder_cadence" CHECK ("manual_accounts"."reminder_cadence_months" between 1 and 24)
);
--> statement-breakpoint
ALTER TABLE "manual_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "manual_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manual_account_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"value_cents" bigint NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_values_value" CHECK ("manual_values"."value_cents" between 0 and 100000000000),
	CONSTRAINT "manual_values_source" CHECK ("manual_values"."source" in ('manual', 'estimate')),
	CONSTRAINT "manual_values_notes_length" CHECK (char_length("manual_values"."notes") <= 500)
);
--> statement-breakpoint
ALTER TABLE "manual_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "networth_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"assets_cents" bigint NOT NULL,
	"liabilities_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"account_count" integer NOT NULL,
	"stale_account_count" integer NOT NULL,
	"source" text DEFAULT 'automatic' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "networth_snapshots_household_as_of_unique" UNIQUE("household_id","as_of"),
	CONSTRAINT "networth_snapshots_source" CHECK ("networth_snapshots"."source" in ('automatic', 'manual')),
	CONSTRAINT "networth_snapshots_totals" CHECK ("networth_snapshots"."assets_cents" >= 0 and "networth_snapshots"."liabilities_cents" <= 0 and "networth_snapshots"."net_cents" = "networth_snapshots"."assets_cents" + "networth_snapshots"."liabilities_cents"),
	CONSTRAINT "networth_snapshots_counts" CHECK ("networth_snapshots"."stale_account_count" between 0 and "networth_snapshots"."account_count"
        and ("networth_snapshots"."source" = 'automatic' or ("networth_snapshots"."account_count" = 0 and "networth_snapshots"."stale_account_count" = 0)))
);
--> statement-breakpoint
ALTER TABLE "networth_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_tombstones" DROP CONSTRAINT "sync_tombstones_entity";--> statement-breakpoint
ALTER TABLE "account_snapshots" ADD CONSTRAINT "account_snapshots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_snapshots" ADD CONSTRAINT "account_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_snapshots" ADD CONSTRAINT "account_snapshots_manual_account_id_manual_accounts_id_fk" FOREIGN KEY ("manual_account_id") REFERENCES "public"."manual_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liability_details" ADD CONSTRAINT "liability_details_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liability_details" ADD CONSTRAINT "liability_details_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_accounts" ADD CONSTRAINT "manual_accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_values" ADD CONSTRAINT "manual_values_manual_account_id_manual_accounts_id_fk" FOREIGN KEY ("manual_account_id") REFERENCES "public"."manual_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "networth_snapshots" ADD CONSTRAINT "networth_snapshots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_snapshots_household_as_of_idx" ON "account_snapshots" USING btree ("household_id","as_of");--> statement-breakpoint
CREATE INDEX "holdings_household_idx" ON "holdings" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "liability_details_household_due_idx" ON "liability_details" USING btree ("household_id","next_payment_due_on");--> statement-breakpoint
CREATE INDEX "manual_accounts_household_name_idx" ON "manual_accounts" USING btree ("household_id",lower("name"),"id");--> statement-breakpoint
CREATE INDEX "manual_values_account_as_of_idx" ON "manual_values" USING btree ("manual_account_id","as_of" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "sync_tombstones" ADD CONSTRAINT "sync_tombstones_entity" CHECK ("sync_tombstones"."entity" in ('household', 'member', 'invitation', 'account', 'category', 'transaction', 'manual_account', 'manual_value', 'bill', 'bill_payment', 'trip', 'booking', 'itinerary_slot', 'trip_idea', 'packing_item', 'packing_template', 'calendar_link', 'event', 'contact', 'asset', 'document', 'maintenance', 'maintenance_log', 'booking_draft', 'digest_preferences'));--> statement-breakpoint
CREATE POLICY "owners and adults read their household's manual accounts" ON "manual_accounts" AS PERMISSIVE FOR SELECT TO authenticated USING ("private"."member_role"("household_id") IN ('owner', 'adult'));--> statement-breakpoint
CREATE POLICY "owners and adults read their household's manual values" ON "manual_values" AS PERMISSIVE FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM "public"."manual_accounts" a WHERE a.id = "manual_values"."manual_account_id" AND "private"."member_role"(a.household_id) IN ('owner', 'adult')));--> statement-breakpoint
CREATE POLICY "owners and adults read their household's account snapshots" ON "account_snapshots" AS PERMISSIVE FOR SELECT TO authenticated USING ("private"."member_role"("household_id") IN ('owner', 'adult'));--> statement-breakpoint
CREATE POLICY "owners and adults read their household's net worth" ON "networth_snapshots" AS PERMISSIVE FOR SELECT TO authenticated USING ("private"."member_role"("household_id") IN ('owner', 'adult'));--> statement-breakpoint
CREATE POLICY "owners and adults read their household's holdings" ON "holdings" AS PERMISSIVE FOR SELECT TO authenticated USING ("private"."member_role"("household_id") IN ('owner', 'adult'));--> statement-breakpoint
CREATE POLICY "owners and adults read their household's liability details" ON "liability_details" AS PERMISSIVE FOR SELECT TO authenticated USING ("private"."member_role"("household_id") IN ('owner', 'adult'));--> statement-breakpoint
CREATE TRIGGER "manual_accounts_set_updated_at" BEFORE INSERT OR UPDATE ON "manual_accounts" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "manual_values_set_updated_at" BEFORE INSERT OR UPDATE ON "manual_values" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "account_snapshots_set_updated_at" BEFORE INSERT OR UPDATE ON "account_snapshots" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "networth_snapshots_set_updated_at" BEFORE INSERT OR UPDATE ON "networth_snapshots" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "holdings_set_updated_at" BEFORE INSERT OR UPDATE ON "holdings" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "liability_details_set_updated_at" BEFORE INSERT OR UPDATE ON "liability_details" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "manual_values_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "manual_values" FOR EACH ROW EXECUTE FUNCTION "private"."touch_parent"('manual_accounts', 'id', 'manual_account_id');--> statement-breakpoint
CREATE TRIGGER "manual_accounts_record_tombstone" AFTER DELETE ON "manual_accounts" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('manual_account', 'id', '');--> statement-breakpoint
CREATE TRIGGER "manual_values_record_tombstone" AFTER DELETE ON "manual_values" FOR EACH ROW EXECUTE FUNCTION "private"."record_tombstone"('manual_value', 'id', '', 'manual_accounts', 'manual_account_id');
