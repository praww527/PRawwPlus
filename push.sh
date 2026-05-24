#!/bin/bash
set -e

CLEAN_URL="https://github.com/praww527/PRawwPlus.git"
AUTH_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/praww527/PRawwPlus.git"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN is not set."
  echo "Add it as a secret in Replit (the lock icon in the sidebar)."
  echo "Create a token at: https://github.com/settings/tokens"
  echo "Required scope: repo (read + write)"
  exit 1
fi

trap 'git remote set-url origin "$CLEAN_URL"' EXIT

echo "==> Pulling remote changes..."
git remote set-url origin "$AUTH_URL"
git pull --no-rebase origin master

echo "==> Pushing local commits..."
git push origin master

echo "==> Done!"
