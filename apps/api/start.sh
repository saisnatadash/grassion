#!/bin/sh

echo "Starting Grassion API..."

echo "Running database migrations..."
cd /app
if node_modules/.bin/tsx packages/db/src/migrate.ts; then
  echo "Migrations complete."
else
  echo "WARNING: migrations failed or skipped — server will start anyway."
fi

echo "Starting API server..."
exec node apps/api/dist/index.js
