#!/bin/sh

echo "Starting Grassion API..."

echo "Running database migrations..."
cd /app
if node packages/db/dist/migrate.js; then
  echo "Migrations complete."
else
  echo "WARNING: migrations failed — server will start anyway. Check DB connection and DIRECT_DATABASE_URL secret."
fi

echo "Starting API server..."
exec node apps/api/dist/index.js
