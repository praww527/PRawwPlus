#!/bin/bash
set -e
git remote set-url origin "https://praww527:${GITHUB_TOKEN}@github.com/praww527/PRawwPlus.git"
git push origin master
git remote set-url origin "https://github.com/praww527/PRawwPlus.git"
echo "Done!"
