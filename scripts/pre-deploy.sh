#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/pre-deploy.sh  —  Health-gated pre-deploy validation
#
# Blocks the deploy if:
#   • TypeScript type-check fails on any workspace package
#   • The local API server's /api/health reports any subsystem unhealthy
#
# Usage:
#   bash scripts/pre-deploy.sh                 (runs checks then deploys to VPS)
#   bash scripts/pre-deploy.sh --check-only    (runs checks only, no deploy)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CHECK_ONLY=false
[[ "${1:-}" == "--check-only" ]] && CHECK_ONLY=true

API_URL="${API_URL:-http://localhost:8080}"
PASS=0
FAIL=0

ok()   { echo "  ✅  $*"; ((PASS++)); }
fail() { echo "  ❌  $*"; ((FAIL++)); }
hdr()  { echo; echo "══════════════════════════════════════════════"; echo "  $*"; echo "══════════════════════════════════════════════"; }

# ── 1. TypeScript ─────────────────────────────────────────────────────────────
hdr "1/3  TypeScript type-check"
if pnpm -r --filter './lib/**' --filter './artifacts/**' run typecheck 2>&1; then
  ok "All packages pass type-check"
else
  fail "TypeScript errors detected — fix before deploying"
fi

# ── 2. Lint (non-fatal if not configured) ────────────────────────────────────
hdr "2/3  ESLint"
if pnpm --filter @workspace/api-server run lint --max-warnings 0 2>/dev/null; then
  ok "No lint warnings"
else
  echo "  ⚠️   lint not configured or warnings found — continuing (non-fatal)"
fi

# ── 3. Subsystem health check ─────────────────────────────────────────────────
hdr "3/3  Subsystem health check  ($API_URL/api/health)"

HEALTH_JSON=$(curl -sf --max-time 5 "$API_URL/api/health" 2>/dev/null || echo "")
if [[ -z "$HEALTH_JSON" ]]; then
  fail "API server is not reachable at $API_URL — is it running?"
else
  echo "  Response: $HEALTH_JSON"
  if echo "$HEALTH_JSON" | grep -q '"healthy":true'; then
    ok "All subsystems healthy"
  else
    fail "One or more subsystems unhealthy — review /api/health before deploying"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo
echo "══════════════════════════════════════════════"
echo "  Pre-deploy summary:  ✅ ${PASS} passed  ❌ ${FAIL} failed"
echo "══════════════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
  echo
  echo "  🚫  Deploy BLOCKED — resolve the failures above before deploying."
  exit 1
fi

if [[ "$CHECK_ONLY" == true ]]; then
  echo "  ✅  All checks passed.  (--check-only; skipping deploy)"
  exit 0
fi

# ── Deploy ────────────────────────────────────────────────────────────────────
echo
echo "  🚀  Checks passed — starting VPS deploy..."
echo
pnpm --filter @workspace/scripts run deploy-vps
