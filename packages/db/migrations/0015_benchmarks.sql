ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "benchmarking_opt_in" boolean DEFAULT false;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "team_size_range" text;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "industry" text;

CREATE TABLE IF NOT EXISTS "industry_benchmarks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tool_name" text NOT NULL,
  "team_size_range" text NOT NULL,
  "industry" text DEFAULT 'all' NOT NULL,
  "metric_name" text NOT NULL,
  "p25_value" real,
  "p50_value" real,
  "p75_value" real,
  "sample_size" integer,
  "computed_at" timestamp DEFAULT now() NOT NULL,
  "valid_until" timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "benchmarks_tool_metric_idx" ON "industry_benchmarks" ("tool_name", "metric_name");
CREATE INDEX IF NOT EXISTS "benchmarks_size_industry_idx" ON "industry_benchmarks" ("team_size_range", "industry");

CREATE TABLE IF NOT EXISTS "team_benchmark_contributions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "benchmark_id" uuid NOT NULL REFERENCES "industry_benchmarks"("id") ON DELETE CASCADE,
  "contributed_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "team_benchmark_contributions_team_benchmark_idx"
  ON "team_benchmark_contributions" ("team_id", "benchmark_id");
