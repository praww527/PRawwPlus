#!/bin/bash
set -e
CLEAN_URL="https://github.com/praww527/PRawwPlus.git"
AUTH_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/praww527/PRawwPlus.git"
trap 'git remote set-url origin "$CLEAN_URL"' EXIT

git remote set-url origin "$AUTH_URL"

echo "==> Pulling remote changes..."
git pull --no-rebase origin master

echo "==> Pushing local commits..."
git push origin master

echo "==> Done!"
