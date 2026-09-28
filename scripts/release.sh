#!/usr/bin/env bash
# Usage: pnpm release <version>
# Bumps every lib to <version>, commits, tags v<version> and pushes.
# The tag push triggers .github/workflows/publish.yml, which publishes to npm.
set -euo pipefail

VERSION="${1:?usage: pnpm release <version>}"
VERSION="${VERSION#v}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean" >&2
  exit 1
fi

for pkg in packages/libs/*/; do
  (cd "$pkg" && npm pkg set version="$VERSION")
done

# Keep the standalone template pointing at the new release.
(cd template && npm pkg set \
  "dependencies[@restatedev/tanstack-workflows]=^$VERSION" \
  "dependencies[@restatedev/tanstack-workflows-client]=^$VERSION")

pnpm install --lockfile-only >/dev/null
pnpm verify

git add packages/libs/*/package.json template/package.json pnpm-lock.yaml
git commit -m "Release v$VERSION"
git tag "v$VERSION"
git push --follow-tags

echo "Pushed v$VERSION, publishing in CI."
