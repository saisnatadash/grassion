#!/bin/sh

echo "Starting Grassion API..."
echo "NODE_ENV: ${NODE_ENV}"
echo "PORT: ${PORT}"
echo "DATABASE_URL configured: ${DATABASE_URL:+yes}"
echo "DIRECT_DATABASE_URL configured: ${DIRECT_DATABASE_URL:+yes}"

# Run migrations - continue even if they fail (tables might already exist)
echo "Running database migrations..."
cd /app
node_modules/.bin/tsx packages/db/src/migrate.ts || {
  MIGRATION_EXIT=$?
  echo "⚠ Migration exited with code $MIGRATION_EXIT"
  echo "Continuing - tables may already exist"
}

echo "Starting API server..."
exec node apps/api/dist/index.js
