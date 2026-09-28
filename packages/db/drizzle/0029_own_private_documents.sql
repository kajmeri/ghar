-- A sensitive document is for owners and adults, and for the person it belongs to, so a member can
-- keep their own passport or medical scan private without losing sight of it themselves.
DROP POLICY "members read their household's documents" ON "documents";--> statement-breakpoint
CREATE POLICY "members read their household's documents" ON "documents"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    "private"."member_role"("household_id") IS NOT NULL
    AND (
      NOT "is_sensitive"
      OR "private"."member_role"("household_id") IN ('owner', 'adult')
      OR EXISTS (SELECT 1 FROM "public"."household_people" p WHERE p."id" = "person_id" AND p."user_id" = (SELECT auth.uid()))
    )
  );
