#!/bin/bash
set -e

echo "=========================================="
echo "Creating Missing Fly.io Apps"
echo "=========================================="

# Check if flyctl is available
if ! command -v flyctl &> /dev/null; then
    echo "Installing flyctl..."
    curl -L https://fly.io/install.sh | sh
    export PATH="$HOME/.fly/bin:$PATH"
fi

echo ""
echo "1. Creating grassion-worker app..."
flyctl apps create grassion-worker --org grassion --region bom || echo "App may already exist"

echo ""
echo "2. Creating grassion-web app (if needed)..."
flyctl apps create grassion-web --org grassion --region bom || echo "App may already exist"

echo ""
echo "3. Listing all Grassion apps..."
flyctl apps list | grep grassion

echo ""
echo "✅ Apps created/verified successfully!"
echo ""
echo "Next steps:"
echo "1. Set Vercel tokens in GitHub secrets:"
echo "   - VERCEL_TOKEN"
echo "   - VERCEL_ORG_ID"
echo "2. Re-run the deployment from GitHub Actions"
