#!/bin/bash
# Push current branch to GitHub using GITHUB_TOKEN.
# Run from the Replit Shell after the agent session ends (which auto-commits).
set -e

CLEAN_URL="https://github.com/praww527/PRawwPlus.git"
AUTH_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/praww527/PRawwPlus.git"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN is not set."
  echo "Add it as a secret in Replit (the lock icon in the sidebar)."
  exit 1
fi

# Temporarily swap the remote to an authenticated URL, restore on exit.
trap 'git remote set-url origin "$CLEAN_URL"' EXIT

echo "==> Pushing to GitHub..."
git remote set-url origin "$AUTH_URL"
git push origin master
echo "==> Done!"
