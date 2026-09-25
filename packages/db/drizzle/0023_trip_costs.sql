ALTER TABLE "trip_guests" ADD CONSTRAINT "trip_guests_id_trip_unique" UNIQUE("id","trip_id");--> statement-breakpoint
CREATE TABLE "trip_cost_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"cost_id" uuid NOT NULL,
	"guest_id" uuid,
	"shares" smallint NOT NULL,
	CONSTRAINT "trip_cost_shares_party_unique" UNIQUE NULLS NOT DISTINCT("cost_id","guest_id"),
	CONSTRAINT "trip_cost_shares_shares" CHECK ("trip_cost_shares"."shares" between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "trip_cost_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_by_guest_id" uuid,
	"spent_on" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_costs_id_trip_unique" UNIQUE("id","trip_id"),
	CONSTRAINT "trip_costs_description_length" CHECK (char_length("trip_costs"."description") between 1 and 80),
	CONSTRAINT "trip_costs_amount" CHECK ("trip_costs"."amount_cents" between 1 and 1000000000)
);
--> statement-breakpoint
ALTER TABLE "trip_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"from_guest_id" uuid,
	"to_guest_id" uuid,
	"amount_cents" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_payments_two_parties" CHECK ("trip_payments"."from_guest_id" is distinct from "trip_payments"."to_guest_id"),
	CONSTRAINT "trip_payments_amount" CHECK ("trip_payments"."amount_cents" between 1 and 1000000000)
);
--> statement-breakpoint
ALTER TABLE "trip_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_cost_shares" ADD CONSTRAINT "trip_cost_shares_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_cost_shares" ADD CONSTRAINT "trip_cost_shares_cost_fk" FOREIGN KEY ("cost_id","trip_id") REFERENCES "public"."trip_costs"("id","trip_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_cost_shares" ADD CONSTRAINT "trip_cost_shares_guest_fk" FOREIGN KEY ("guest_id","trip_id") REFERENCES "public"."trip_guests"("id","trip_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_costs" ADD CONSTRAINT "trip_costs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_costs" ADD CONSTRAINT "trip_costs_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_costs" ADD CONSTRAINT "trip_costs_paid_by_fk" FOREIGN KEY ("paid_by_guest_id","trip_id") REFERENCES "public"."trip_guests"("id","trip_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_payments" ADD CONSTRAINT "trip_payments_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_payments" ADD CONSTRAINT "trip_payments_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_payments" ADD CONSTRAINT "trip_payments_from_fk" FOREIGN KEY ("from_guest_id","trip_id") REFERENCES "public"."trip_guests"("id","trip_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_payments" ADD CONSTRAINT "trip_payments_to_fk" FOREIGN KEY ("to_guest_id","trip_id") REFERENCES "public"."trip_guests"("id","trip_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_cost_shares_cost_idx" ON "trip_cost_shares" USING btree ("cost_id","trip_id");--> statement-breakpoint
CREATE INDEX "trip_cost_shares_trip_idx" ON "trip_cost_shares" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_cost_shares_guest_idx" ON "trip_cost_shares" USING btree ("guest_id","trip_id") WHERE "trip_cost_shares"."guest_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_costs_trip_idx" ON "trip_costs" USING btree ("trip_id","spent_on");--> statement-breakpoint
CREATE INDEX "trip_costs_paid_by_idx" ON "trip_costs" USING btree ("paid_by_guest_id","trip_id") WHERE "trip_costs"."paid_by_guest_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_costs_created_by_idx" ON "trip_costs" USING btree ("created_by") WHERE "trip_costs"."created_by" is not null;--> statement-breakpoint
CREATE INDEX "trip_payments_trip_idx" ON "trip_payments" USING btree ("trip_id","paid_on");--> statement-breakpoint
CREATE INDEX "trip_payments_from_idx" ON "trip_payments" USING btree ("from_guest_id","trip_id") WHERE "trip_payments"."from_guest_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_payments_to_idx" ON "trip_payments" USING btree ("to_guest_id","trip_id") WHERE "trip_payments"."to_guest_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_payments_created_by_idx" ON "trip_payments" USING btree ("created_by") WHERE "trip_payments"."created_by" is not null;--> statement-breakpoint
CREATE TRIGGER "trip_costs_set_updated_at" BEFORE INSERT OR UPDATE ON "trip_costs" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();--> statement-breakpoint
-- Everyone on the trip sees its shared costs, how they're split, and who has paid whom back.
-- Writes go through the data access layer only.
CREATE POLICY "people on the trip read its shared costs" ON "trip_costs"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."can_see_trip"("trip_id"));--> statement-breakpoint
CREATE POLICY "people on the trip read how costs are split" ON "trip_cost_shares"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."can_see_trip"("trip_id"));--> statement-breakpoint
CREATE POLICY "people on the trip read who paid whom back" ON "trip_payments"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."can_see_trip"("trip_id"));
