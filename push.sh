#!/bin/bash
set -e
CLEAN_URL="https://github.com/praww527/PRawwPlus.git"
trap 'git remote set-url origin "$CLEAN_URL"' EXIT
git remote set-url origin "https://praww527:${GITHUB_TOKEN}@github.com/praww527/PRawwPlus.git"
git push origin master
echo "Done!"
