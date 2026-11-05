#!/bin/sh

echo "Starting Grassion API..."
echo "NODE_ENV: ${NODE_ENV}"
echo "PORT: ${PORT}"
echo "DATABASE_URL configured: ${DATABASE_URL:+yes}"

# Ensure critical schema columns exist before the full Drizzle migrator runs.
# This is a belt-and-suspenders guard: Drizzle enumerates ALL schema columns
# in INSERT queries, so a missing column (from an unapplied migration) causes
# every new-user signup to fail.  All statements use IF NOT EXISTS — idempotent.
echo "Running schema bootstrap..."
node /app/packages/db/dist/ensure-schema.js || {
  echo "Schema bootstrap exited non-zero — continuing"
}

# Run the pre-compiled migration script (compiled during Docker build).
# Using `node` not `tsx` so there's no TypeScript JIT overhead at startup.
echo "Running database migrations..."
node /app/packages/db/dist/migrate.js || {
  MIGRATION_EXIT=$?
  echo "Migration exited with code $MIGRATION_EXIT - continuing"
}

echo "Starting API server..."
exec node apps/api/dist/index.js
