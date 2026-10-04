ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "per_seat_cost_usd" real DEFAULT 19;
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "tool_seat_costs" jsonb DEFAULT '{}';
