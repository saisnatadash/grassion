#!/bin/sh
set -e

echo "Running database migrations..."
cd /app/packages/db
node dist/migrate.js
echo "Migrations complete."

echo "Starting Grassion API..."
cd /app
exec node apps/api/dist/index.js
