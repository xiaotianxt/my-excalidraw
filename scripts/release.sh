#!/bin/bash
set -euo pipefail

# Version changes and release notes must be reviewed/committed before tagging.
VERSION=$(node -p 'require("./package.json").version')
if [[ -n "${1:-}" && "$1" != "$VERSION" ]]; then
  echo "Requested version differs from package.json ($VERSION). Update and commit it first." >&2
  exit 1
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "This workflow publishes stable versions only." >&2
  exit 1
fi
TAG="v$VERSION"
if [[ "$(git branch --show-current)" != main || -n "$(git status --porcelain)" ]]; then
  echo "Release requires a clean main branch." >&2
  exit 1
fi
test -f "docs/releases/$TAG.md"
git fetch origin main --tags
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "Local main must exactly match origin/main." >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "$TAG already exists; never move a published tag." >&2
  exit 1
fi
git tag -a "$TAG" -m "Release $TAG"
git push origin "$TAG"
echo "Pushed $TAG. Desktop Release will publish only after all installer builds succeed."
