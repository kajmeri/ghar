ALTER TYPE "public"."plaid_item_status" ADD VALUE 'disconnected';--> statement-breakpoint
ALTER TABLE "plaid_items" ALTER COLUMN "access_token_encrypted" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN "disconnected_at" timestamp with time zone;