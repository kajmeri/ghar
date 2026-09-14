CREATE TYPE "public"."bank_environment" AS ENUM('fake', 'sandbox', 'production');--> statement-breakpoint
CREATE TYPE "public"."budget_period_type" AS ENUM('monthly');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."category_matcher_type" AS ENUM('merchant_exact', 'merchant_contains', 'name_regex', 'amount_range');--> statement-breakpoint
CREATE TYPE "public"."category_source" AS ENUM('user', 'rule', 'pfc', 'llm');--> statement-breakpoint
CREATE TYPE "public"."plaid_item_status" AS ENUM('good', 'login_required', 'error');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"plaid_item_id" uuid NOT NULL,
	"plaid_account_id" text NOT NULL,
	"name" text NOT NULL,
	"official_name" text,
	"mask" text,
	"type" text NOT NULL,
	"subtype" text,
	"current_balance_cents" bigint,
	"available_balance_cents" bigint,
	"iso_currency" char(3),
	"is_hidden" boolean DEFAULT false NOT NULL,
	"balance_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_item_plaid_account_unique" UNIQUE("plaid_item_id","plaid_account_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"planned_cents" bigint NOT NULL,
	"rollover_enabled" boolean DEFAULT false NOT NULL,
	"rollover_in_cents" bigint DEFAULT 0 NOT NULL,
	"actual_cents" bigint,
	CONSTRAINT "budget_lines_budget_category_unique" UNIQUE("budget_id","category_id"),
	CONSTRAINT "budget_lines_planned_cents" CHECK ("budget_lines"."planned_cents" between 0 and 1000000000)
);
--> statement-breakpoint
ALTER TABLE "budget_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_type" "budget_period_type" DEFAULT 'monthly' NOT NULL,
	"closed_at" timestamp with time zone,
	"unbudgeted_cents" bigint,
	"uncategorized_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_household_period_unique" UNIQUE("household_id","period_start"),
	CONSTRAINT "budgets_period_start_first_day" CHECK (extract(day from "budgets"."period_start") = 1),
	CONSTRAINT "budgets_closed_snapshot" CHECK (("budgets"."closed_at" is null) = ("budgets"."unbudgeted_cents" is null)
        and ("budgets"."closed_at" is null) = ("budgets"."uncategorized_cents" is null))
);
--> statement-breakpoint
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"kind" "category_kind" NOT NULL,
	"icon" text NOT NULL,
	"color_token" text DEFAULT 'ink-muted' NOT NULL,
	"system_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_length" CHECK (char_length("categories"."name") between 1 and 40),
	CONSTRAINT "categories_not_own_parent" CHECK ("categories"."parent_id" <> "categories"."id"),
	CONSTRAINT "categories_color_token" CHECK ("categories"."color_token" in ('ink', 'ink-muted', 'positive', 'caution', 'negative'))
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "category_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"matcher_type" "category_matcher_type" NOT NULL,
	"matcher_value" text NOT NULL,
	"category_id" uuid NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_rules_matcher_unique" UNIQUE("household_id","matcher_type","matcher_value"),
	CONSTRAINT "category_rules_matcher_value_length" CHECK (char_length("category_rules"."matcher_value") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "category_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_cents" bigint NOT NULL,
	"target_date" date,
	"linked_account_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_name_length" CHECK (char_length("goals"."name") between 1 and 80),
	CONSTRAINT "goals_target_cents" CHECK ("goals"."target_cents" between 1 and 1000000000),
	CONSTRAINT "goals_notes_length" CHECK (char_length("goals"."notes") <= 500)
);
--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plaid_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"environment" "bank_environment" NOT NULL,
	"plaid_item_id" text NOT NULL,
	"institution_id" text,
	"institution_name" text,
	"access_token_encrypted" text NOT NULL,
	"cursor" text,
	"status" "plaid_item_status" DEFAULT 'good' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"consent_expires_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plaid_items_plaid_item_id_unique" UNIQUE("plaid_item_id")
);
--> statement-breakpoint
ALTER TABLE "plaid_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transaction_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"user_id" uuid,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_edits_field" CHECK ("transaction_edits"."field" in ('category_id', 'notes', 'is_excluded'))
);
--> statement-breakpoint
ALTER TABLE "transaction_edits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"plaid_transaction_id" text NOT NULL,
	"pending_transaction_id" text,
	"amount_cents" bigint NOT NULL,
	"iso_currency" char(3),
	"date" date NOT NULL,
	"authorized_date" date,
	"merchant_name" text,
	"name" text NOT NULL,
	"payment_channel" text,
	"plaid_category_primary" text,
	"plaid_category_detailed" text,
	"plaid_category_confidence" text,
	"category_id" uuid,
	"category_source" "category_source",
	"category_confidence" smallint,
	"category_rule_id" uuid,
	"suggested_category_id" uuid,
	"needs_review" boolean DEFAULT false NOT NULL,
	"is_pending" boolean DEFAULT false NOT NULL,
	"is_transfer" boolean DEFAULT false NOT NULL,
	"is_excluded" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_plaid_transaction_id_unique" UNIQUE("plaid_transaction_id"),
	CONSTRAINT "transactions_notes_length" CHECK (char_length("transactions"."notes") <= 500),
	CONSTRAINT "transactions_category_confidence" CHECK ("transactions"."category_confidence" between 0 and 100),
	CONSTRAINT "transactions_category_has_source" CHECK ("transactions"."category_id" is null or "transactions"."category_source" is not null),
	CONSTRAINT "transactions_review_uncategorized" CHECK (not ("transactions"."needs_review" and "transactions"."category_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_created_by_user_id_profiles_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_linked_account_id_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_edits" ADD CONSTRAINT "transaction_edits_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_edits" ADD CONSTRAINT "transaction_edits_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_rule_id_category_rules_id_fk" FOREIGN KEY ("category_rule_id") REFERENCES "public"."category_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_suggested_category_id_categories_id_fk" FOREIGN KEY ("suggested_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_household_idx" ON "accounts" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "budget_lines_category_idx" ON "budget_lines" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_household_name_unique" ON "categories" USING btree ("household_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "categories_household_system_key_unique" ON "categories" USING btree ("household_id","system_key") WHERE "categories"."system_key" is not null;--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "category_rules_category_idx" ON "category_rules" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "goals_household_idx" ON "goals" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "plaid_items_household_idx" ON "plaid_items" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "transaction_edits_transaction_idx" ON "transaction_edits" USING btree ("transaction_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_household_date_idx" ON "transactions" USING btree ("household_id","date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("account_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_household_uncategorized_idx" ON "transactions" USING btree ("household_id","date" DESC NULLS LAST) WHERE "transactions"."category_id" is null;--> statement-breakpoint
-- plaid_items has no policy on purpose. It holds access tokens, so only the server connection
-- reads it.
CREATE POLICY "owners and adults read their household's categories" ON "categories"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IN ('owner', 'adult'));--> statement-breakpoint
CREATE POLICY "owners and adults read their household's category rules" ON "category_rules"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IN ('owner', 'adult'));--> statement-breakpoint
CREATE POLICY "owners and adults read their household's accounts" ON "accounts"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IN ('owner', 'adult'));--> statement-breakpoint
CREATE POLICY "owners and adults read their household's transactions" ON "transactions"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IN ('owner', 'adult'));--> statement-breakpoint
CREATE POLICY "owners and adults read their household's transaction edits" ON "transaction_edits"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."transactions" t
      WHERE t.id = "transaction_edits"."transaction_id"
        AND "private"."member_role"(t.household_id) IN ('owner', 'adult')
    )
  );--> statement-breakpoint
CREATE POLICY "owners and adults read their household's budgets" ON "budgets"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IN ('owner', 'adult'));--> statement-breakpoint
CREATE POLICY "owners and adults read their household's budget lines" ON "budget_lines"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."budgets" b
      WHERE b.id = "budget_lines"."budget_id"
        AND "private"."member_role"(b.household_id) IN ('owner', 'adult')
    )
  );--> statement-breakpoint
CREATE POLICY "owners and adults read their household's goals" ON "goals"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IN ('owner', 'adult'));