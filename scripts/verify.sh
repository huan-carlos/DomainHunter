#!/usr/bin/env bash
# DomainHunter repeatable verification path.
# Proves the scaffold installs, typechecks, and passes tests.
set -euo pipefail

cd "$(dirname "$0")/.."

# Dev tooling (typescript, @types/node) must be installable even when the
# runner exports NODE_ENV=production.
unset NODE_ENV

echo "==> Installing dependencies"
pnpm install --frozen-lockfile

echo "==> Typechecking all workspaces"
pnpm -r typecheck

echo "==> Running tests"
pnpm -r test

echo "==> Verification passed"
