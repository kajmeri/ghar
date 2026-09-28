CREATE TABLE "packing_suggestion_dismissals" (
	"trip_id" uuid NOT NULL,
	"suggestion_key" text NOT NULL,
	"dismissed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packing_suggestion_dismissals_trip_id_suggestion_key_pk" PRIMARY KEY("trip_id","suggestion_key"),
	CONSTRAINT "packing_suggestion_dismissals_key_length" CHECK (char_length("packing_suggestion_dismissals"."suggestion_key") between 1 and 64)
);
--> statement-breakpoint
ALTER TABLE "packing_suggestion_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "packing_items" ADD COLUMN "suggestion_key" text;--> statement-breakpoint
ALTER TABLE "packing_suggestion_dismissals" ADD CONSTRAINT "packing_suggestion_dismissals_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_suggestion_dismissals" ADD CONSTRAINT "packing_suggestion_dismissals_dismissed_by_profiles_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "packing_suggestion_dismissals_dismissed_by_idx" ON "packing_suggestion_dismissals" USING btree ("dismissed_by") WHERE "packing_suggestion_dismissals"."dismissed_by" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "packing_items_suggestion_key_idx" ON "packing_items" USING btree ("trip_id","suggestion_key") WHERE "packing_items"."suggestion_key" is not null;--> statement-breakpoint
CREATE POLICY "people on the trip see its dismissed suggestions" ON "packing_suggestion_dismissals"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ("private"."can_see_trip"("trip_id"));
