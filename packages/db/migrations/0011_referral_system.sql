CREATE TABLE IF NOT EXISTS "referral_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "partner_name" text NOT NULL,
  "partner_email" text NOT NULL,
  "commission_pct" real DEFAULT 20.0,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referral_conversions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "referral_code_id" uuid NOT NULL,
  "team_id" uuid NOT NULL,
  "converted_at" timestamp DEFAULT now() NOT NULL,
  "plan_at_conversion" text NOT NULL,
  "mrr_usd" real NOT NULL,
  "commission_usd" real NOT NULL,
  CONSTRAINT "referral_conversions_code_team_idx" UNIQUE("referral_code_id", "team_id")
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "referral_code" text;
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "referral_code_id" uuid;
--> statement-breakpoint
ALTER TABLE "referral_conversions" ADD CONSTRAINT "referral_conversions_referral_code_id_fkey"
  FOREIGN KEY ("referral_code_id") REFERENCES "referral_codes"("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "referral_conversions" ADD CONSTRAINT "referral_conversions_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_referral_code_id_fkey"
  FOREIGN KEY ("referral_code_id") REFERENCES "referral_codes"("id") ON DELETE NO ACTION;
