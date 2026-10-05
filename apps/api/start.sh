#!/bin/sh
set -e

echo "Starting Grassion API..."

# Run migrations with tsx
echo "Running database migrations..."
cd /app
node_modules/.bin/tsx packages/db/src/migrate.ts

echo "Migrations complete."

# Start the app
echo "Starting API server..."
exec node apps/api/dist/index.js
