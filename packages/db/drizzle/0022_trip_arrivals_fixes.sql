DROP INDEX "trip_room_assignments_room_idx";--> statement-breakpoint
CREATE INDEX "trip_room_assignments_room_idx" ON "trip_room_assignments" USING btree ("room_id","trip_id");--> statement-breakpoint
CREATE TRIGGER "trip_arrivals_set_updated_at" BEFORE INSERT OR UPDATE ON "trip_arrivals" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();
