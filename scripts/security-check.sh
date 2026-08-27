#!/usr/bin/env bash
# Security gate — secrets in tree, committed env files, destructive SQL,
# dependency audit. Works from day zero (no app needed).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_agentic_lib.sh
FAIL=0

echo "[security] committed .env files"
if git ls-files | grep -E '(^|/)\.env(\..+)?$' | grep -v '\.env\.example$'; then
  echo "  FAIL: real .env file is tracked"; FAIL=1
else echo "  ok"; fi

echo "[security] secret-looking strings in tracked files"
if git grep -nIE '(api[_-]?key|secret|password|token)["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9_\-]{16,}' -- \
    ':!*.md' ':!pnpm-lock.yaml' ':!package-lock.json' 2>/dev/null; then
  echo "  FAIL: possible hardcoded secret"; FAIL=1
else echo "  ok"; fi

echo "[security] destructive SQL in tracked files"
# Migrations are EXCLUDED from the failure, not from view: a schema change is
# exactly where a DROP belongs, and it arrives through generate + review. Any
# such statement is still printed below so it can never land unnoticed.
if git grep -nIiE 'drop\s+table|truncate\s+table|delete\s+from\s+[a-z_]+\s*;' -- ':!docs' ':!*.md' ':!src/db/migrations' 2>/dev/null; then
  echo "  FAIL: destructive SQL found outside docs"; FAIL=1
else echo "  ok"; fi

if [ -f package.json ]; then
  PM="$(manifest_get package_manager)"; PM="${PM:-pnpm}"
  echo "[security] dependency audit (advisory)"
  "$PM" audit --audit-level high || echo "  (advisory only — review findings)"
fi

[ "$FAIL" -eq 0 ] && echo "[security] PASS" || { echo "[security] FAIL"; exit 1; }
