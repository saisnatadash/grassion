#!/bin/sh

echo "Starting Grassion API..."
echo "NODE_ENV: ${NODE_ENV}"
echo "PORT: ${PORT}"
echo "DATABASE_URL configured: ${DATABASE_URL:+yes}"

# Run the pre-compiled migration script (compiled during Docker build).
# Using `node` not `tsx` so there's no TypeScript JIT overhead at startup.
echo "Running database migrations..."
node /app/packages/db/dist/migrate.js || {
  MIGRATION_EXIT=$?
  echo "Migration exited with code $MIGRATION_EXIT - continuing"
}

echo "Starting API server..."
exec node apps/api/dist/index.js
