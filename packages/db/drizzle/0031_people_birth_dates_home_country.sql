ALTER TABLE "household_people" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "home_country" char(2);--> statement-breakpoint
ALTER TABLE "household_people" ADD CONSTRAINT "household_people_birth_date_floor" CHECK ("household_people"."birth_date" >= '1900-01-01');--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_home_country_code" CHECK ("households"."home_country" ~ '^[A-Z]{2}$');