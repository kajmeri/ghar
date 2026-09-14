CREATE TYPE "public"."booking_kind" AS ENUM('flight', 'hotel', 'car');--> statement-breakpoint
CREATE TYPE "public"."booking_rate_plan" AS ENUM('prepaid', 'pay_at_property', 'refundable');--> statement-breakpoint
CREATE TYPE "public"."booking_source" AS ENUM('manual', 'email');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('booked', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."price_confidence" AS ENUM('cached', 'exact');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" "booking_kind" NOT NULL,
	"status" "booking_status" DEFAULT 'booked' NOT NULL,
	"confirmation_code" text,
	"provider_name" text,
	"carrier" text,
	"cabin" text,
	"rate_plan" "booking_rate_plan",
	"refundable" boolean DEFAULT false NOT NULL,
	"origin" text,
	"destination" text,
	"property_name" text,
	"check_in" date,
	"check_out" date,
	"depart_at" timestamp with time zone,
	"return_at" timestamp with time zone,
	"travelers" smallint DEFAULT 1 NOT NULL,
	"paid_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"source" "booking_source" DEFAULT 'manual' NOT NULL,
	"source_message_id" text,
	"raw_extract" jsonb,
	"watch_enabled" boolean DEFAULT true NOT NULL,
	"trip_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_travelers" CHECK ("bookings"."travelers" between 1 and 9),
	CONSTRAINT "bookings_paid_cents" CHECK ("bookings"."paid_cents" between 1 and 100000000),
	CONSTRAINT "bookings_currency_code" CHECK ("bookings"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "bookings_carrier_code" CHECK ("bookings"."carrier" ~ '^[A-Z0-9]{2}$'),
	CONSTRAINT "bookings_airport_codes" CHECK ("bookings"."kind" <> 'flight' or ("bookings"."origin" ~ '^[A-Z]{3}$' and "bookings"."destination" ~ '^[A-Z]{3}$')),
	CONSTRAINT "bookings_cabin" CHECK ("bookings"."cabin" in ('basic_economy', 'economy', 'premium_economy', 'business', 'first')),
	CONSTRAINT "bookings_text_lengths" CHECK (char_length("bookings"."confirmation_code") <= 40
        and char_length("bookings"."provider_name") <= 80
        and char_length("bookings"."property_name") <= 120
        and char_length("bookings"."origin") <= 80
        and char_length("bookings"."destination") <= 80),
	CONSTRAINT "bookings_flight_shape" CHECK ("bookings"."kind" <> 'flight' or (
        "bookings"."carrier" is not null and "bookings"."cabin" is not null
        and "bookings"."origin" is not null and "bookings"."destination" is not null
        and "bookings"."depart_at" is not null and "bookings"."rate_plan" is null
        and "bookings"."check_in" is null and "bookings"."check_out" is null
      )),
	CONSTRAINT "bookings_stay_shape" CHECK ("bookings"."kind" = 'flight' or (
        "bookings"."rate_plan" is not null and "bookings"."check_in" is not null
        and "bookings"."check_out" is not null and "bookings"."depart_at" is null
        and "bookings"."return_at" is null and "bookings"."carrier" is null and "bookings"."cabin" is null
        and "bookings"."refundable" = ("bookings"."rate_plan" = 'refundable')
      )),
	CONSTRAINT "bookings_hotel_property" CHECK ("bookings"."kind" <> 'hotel' or "bookings"."property_name" is not null),
	CONSTRAINT "bookings_return_after_depart" CHECK ("bookings"."return_at" > "bookings"."depart_at"),
	CONSTRAINT "bookings_check_out_after_check_in" CHECK (case when "bookings"."kind" = 'hotel' then "bookings"."check_out" > "bookings"."check_in"
        else "bookings"."check_out" >= "bookings"."check_in" end)
);
--> statement-breakpoint
ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price_cents" bigint NOT NULL,
	"delta_cents" bigint NOT NULL,
	"floor_cents" bigint NOT NULL,
	CONSTRAINT "price_alerts_drop" CHECK ("price_alerts"."delta_cents" < 0),
	CONSTRAINT "price_alerts_prices" CHECK ("price_alerts"."price_cents" > 0 and "price_alerts"."floor_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "price_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"price_cents" bigint,
	"confidence" "price_confidence" NOT NULL,
	"success" boolean NOT NULL,
	"error" text,
	CONSTRAINT "price_checks_outcome" CHECK (("price_checks"."success" and "price_checks"."price_cents" > 0 and "price_checks"."error" is null)
        or (not "price_checks"."success" and "price_checks"."price_cents" is null and "price_checks"."error" is not null)),
	CONSTRAINT "price_checks_error_length" CHECK (char_length("price_checks"."error") <= 500)
);
--> statement-breakpoint
ALTER TABLE "price_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_checks" ADD CONSTRAINT "price_checks_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_household_idx" ON "bookings" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "bookings_watched_idx" ON "bookings" USING btree ("household_id") WHERE "bookings"."watch_enabled" and "bookings"."status" = 'booked';--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_source_message_unique" ON "bookings" USING btree ("household_id","source_message_id") WHERE "bookings"."source_message_id" is not null;--> statement-breakpoint
CREATE INDEX "price_alerts_booking_sent_idx" ON "price_alerts" USING btree ("booking_id","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_checks_booking_checked_idx" ON "price_checks" USING btree ("booking_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "members read their household's bookings" ON "bookings"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."member_role"("household_id") IS NOT NULL);--> statement-breakpoint
CREATE POLICY "members read their household's price checks" ON "price_checks"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."bookings" b
      WHERE b.id = "price_checks"."booking_id"
        AND "private"."member_role"(b.household_id) IS NOT NULL
    )
  );--> statement-breakpoint
CREATE POLICY "members read their household's price alerts" ON "price_alerts"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."bookings" b
      WHERE b.id = "price_alerts"."booking_id"
        AND "private"."member_role"(b.household_id) IS NOT NULL
    )
  );