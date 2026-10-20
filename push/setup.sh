#!/bin/bash
# One-time setup for Domso reminders. Run from Terminal:
#   bash "push/setup.sh"
set -e
cd "$(dirname "$0")"
SECRETS="${SECRETS:-$HOME/Documents/My projects Personal/domso-secrets}"
[ -f "$SECRETS/vapid-private.json" ] || { echo "Missing $SECRETS/vapid-private.json"; exit 1; }

echo "1/4  Log in to Cloudflare (a browser tab opens, click Allow)"
npx -y wrangler@latest login

echo "2/4  Deploying the reminder worker"
npx -y wrangler@latest deploy

echo "3/4  Storing the private push key (not in the repo)"
npx -y wrangler@latest secret put VAPID_PRIVATE_JWK < "$SECRETS/vapid-private.json"
npx -y wrangler@latest secret put TEST_TOKEN < "$SECRETS/test-token.txt"

echo
echo "4/4  Done. Reminders now check every minute."
echo "     After she taps Enable reminders in the app, test with:"
echo "     https://domso-push.<your-subdomain>.workers.dev/test?t=$(cat "$SECRETS/test-token.txt")"
echo "     (the exact workers.dev address is printed in step 2)"
