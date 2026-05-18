ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "slug" text;
--> statement-breakpoint
UPDATE "teams"
SET "slug" = LOWER(REGEXP_REPLACE(COALESCE("github_account_login", "id"::text), '[^a-z0-9]+', '-', 'g'))
WHERE "slug" IS NULL OR "slug" = '';
--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "slug" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "teams" ADD CONSTRAINT "teams_slug_unique" UNIQUE("slug");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
