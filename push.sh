#!/bin/bash
set -e
CLEAN_URL="https://github.com/praww527/PRawwPlus.git"
trap 'git remote set-url origin "$CLEAN_URL"' EXIT
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/praww527/PRawwPlus.git"
git push origin master
echo "Done!"
