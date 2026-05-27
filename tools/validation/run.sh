#!/usr/bin/env bash
# =============================================================================
# PRaww+ Validation Runner
# =============================================================================
# Runs one or more validation phases against a live platform instance.
#
# Usage:
#   ./tools/validation/run.sh [OPTIONS]
#
# Options:
#   --phase <name>        Phase to run: soak | chaos | calls | security |
#                                       metrics | all  (default: metrics)
#   --base-url <url>      Platform base URL  (default: $BASE_URL or https://rtc.praww.co.za)
#   --admin-key <key>     ADMIN_API_KEY      (default: $ADMIN_API_KEY)
#   --ssh-host <ip>       VPS SSH host       (default: 158.180.29.84)
#   --ssh-user <user>     SSH user           (default: ubuntu)
#   --ssh-key <path>      Path to SSH private key
#   --session-id <sid>    User session SID for call/security tests
#   --to-number <num>     Destination number for call tests
#   --duration <secs>     Soak duration in seconds (default: 86400)
#   --chaos-target <t>    Chaos target: freeswitch|esl|db|websocket|all
#   --log-dir <dir>       Directory for log files (default: ./validation-logs)
#
# Environment variables (alternative to CLI flags):
#   BASE_URL, ADMIN_API_KEY, VPS_HOST, VPS_USER, SSH_KEY_PATH,
#   TEST_SESSION, TEST_TO_NUM
#
# Examples:
#   # Quick metrics sanity check (fast, no SSH needed):
#   ./tools/validation/run.sh --phase metrics --base-url https://rtc.praww.co.za
#
#   # Security fuzz (needs a session ID):
#   ./tools/validation/run.sh --phase security --session-id <sid>
#
#   # Full chaos suite (needs SSH credentials):
#   ./tools/validation/run.sh --phase chaos --chaos-target all --ssh-key ~/.ssh/id_rsa
#
#   # 1-hour soak test:
#   ./tools/validation/run.sh --phase soak --duration 3600
#
#   # All phases (long-running):
#   ./tools/validation/run.sh --phase all --ssh-key ~/.ssh/id_rsa --session-id <sid>
# =============================================================================

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
PHASE="${PHASE:-metrics}"
BASE_URL="${BASE_URL:-https://rtc.praww.co.za}"
ADMIN_KEY="${ADMIN_API_KEY:-}"
SSH_HOST="${VPS_HOST:-158.180.29.84}"
SSH_USER="${VPS_USER:-ubuntu}"
SSH_KEY="${SSH_KEY_PATH:-}"
SESSION_ID="${TEST_SESSION:-}"
TO_NUMBER="${TEST_TO_NUM:-}"
DURATION="${SOAK_DURATION:-86400}"
CHAOS_TARGET="${CHAOS_TARGET:-websocket}"
LOG_DIR="${LOG_DIR:-./validation-logs}"

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)         PHASE="$2";         shift 2 ;;
    --base-url)      BASE_URL="$2";      shift 2 ;;
    --admin-key)     ADMIN_KEY="$2";     shift 2 ;;
    --ssh-host)      SSH_HOST="$2";      shift 2 ;;
    --ssh-user)      SSH_USER="$2";      shift 2 ;;
    --ssh-key)       SSH_KEY="$2";       shift 2 ;;
    --session-id)    SESSION_ID="$2";    shift 2 ;;
    --to-number)     TO_NUMBER="$2";     shift 2 ;;
    --duration)      DURATION="$2";      shift 2 ;;
    --chaos-target)  CHAOS_TARGET="$2";  shift 2 ;;
    --log-dir)       LOG_DIR="$2";       shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Validate required args ────────────────────────────────────────────────────
if [[ -z "$ADMIN_KEY" ]]; then
  echo "ERROR: ADMIN_API_KEY / --admin-key is required"
  exit 1
fi

# ── Setup ─────────────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RESULTS=()

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
section() { echo ""; echo "══════════════════════════════════════════════════════════"; echo "  $*"; echo "══════════════════════════════════════════════════════════"; }
pass() { RESULTS+=("PASS  $1"); log "PASS: $1"; }
fail() { RESULTS+=("FAIL  $1"); log "FAIL: $1"; }

run_phase() {
  local name="$1"; shift
  local logfile="$LOG_DIR/${name}-${TIMESTAMP}.log"
  log "Running phase: $name → $logfile"
  if "$@" 2>&1 | tee "$logfile"; then
    pass "$name"
  else
    fail "$name"
  fi
}

# ── TSX runner ────────────────────────────────────────────────────────────────
TSX="$(command -v tsx 2>/dev/null || npx tsx 2>/dev/null && echo "npx tsx" || echo "")"
if [[ -z "$TSX" ]]; then
  # Try via pnpm
  TSX="pnpm exec tsx"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

tsx_run() {
  local script="$1"; shift
  $TSX "$SCRIPT_DIR/$script" "$@"
}

# ── Common args ───────────────────────────────────────────────────────────────
COMMON=(--base-url "$BASE_URL" --admin-key "$ADMIN_KEY")
SSH_ARGS=()
[[ -n "$SSH_KEY"   ]] && SSH_ARGS+=(--ssh-key  "$SSH_KEY")
[[ -n "$SSH_HOST"  ]] && SSH_ARGS+=(--ssh-host "$SSH_HOST")
[[ -n "$SSH_USER"  ]] && SSH_ARGS+=(--ssh-user "$SSH_USER")

# ── Phase 1: Soak test ────────────────────────────────────────────────────────
run_soak() {
  section "PHASE 1 — SOAK TEST (${DURATION}s)"
  run_phase "soak" tsx_run "soak-test.ts" "${COMMON[@]}" --duration "$DURATION"
}

# ── Phase 2: Chaos ────────────────────────────────────────────────────────────
run_chaos() {
  section "PHASE 2 — FAILURE INJECTION (target: $CHAOS_TARGET)"
  if [[ ${#SSH_ARGS[@]} -eq 0 ]]; then
    log "SKIP: chaos requires --ssh-key (or SSH_KEY_PATH). Skipping."
    RESULTS+=("SKIP  chaos (no SSH key)")
    return
  fi
  run_phase "chaos" tsx_run "chaos.ts" "${COMMON[@]}" "${SSH_ARGS[@]}" --target "$CHAOS_TARGET"
}

# ── Phase 3: Call validation ──────────────────────────────────────────────────
run_calls() {
  section "PHASE 3 — REAL CALL VALIDATION"
  if [[ -z "$SESSION_ID" || -z "$TO_NUMBER" ]]; then
    log "SKIP: call validation requires --session-id and --to-number"
    RESULTS+=("SKIP  calls (no session or number)")
    return
  fi
  run_phase "calls" tsx_run "call-validator.ts" "${COMMON[@]}" \
    --session-id "$SESSION_ID" \
    --to-number  "$TO_NUMBER"
}

# ── Phase 5: Metrics cross-check ──────────────────────────────────────────────
run_metrics() {
  section "PHASE 5 — OBSERVABILITY / METRICS CROSS-CHECK"
  run_phase "metrics" tsx_run "metrics-crosscheck.ts" "${COMMON[@]}" \
    ${SESSION_ID:+--session "$SESSION_ID"}
}

# ── Phase 7: Security fuzz ────────────────────────────────────────────────────
run_security() {
  section "PHASE 7 — SECURITY VALIDATION"
  run_phase "security" tsx_run "security-fuzz.ts" "${COMMON[@]}" \
    ${SESSION_ID:+--session-id "$SESSION_ID"}
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
section "PRaww+ Validation Suite — phase=$PHASE target=$BASE_URL"
log "Log directory: $LOG_DIR"

case "$PHASE" in
  soak)     run_soak     ;;
  chaos)    run_chaos    ;;
  calls)    run_calls    ;;
  metrics)  run_metrics  ;;
  security) run_security ;;
  all)
    run_metrics
    run_security
    run_calls
    run_chaos
    # Soak last (long-running)
    run_soak
    ;;
  *) echo "Unknown phase: $PHASE. Use: soak | chaos | calls | security | metrics | all"; exit 1 ;;
esac

# ── Summary ───────────────────────────────────────────────────────────────────
section "VALIDATION SUMMARY"
FAILURES=0
for r in "${RESULTS[@]}"; do
  echo "  $r"
  [[ "$r" == FAIL* ]] && FAILURES=$((FAILURES + 1))
done
echo ""
echo "Logs written to: $LOG_DIR/"
echo ""
if [[ $FAILURES -eq 0 ]]; then
  echo "Result: PASS (all phases passed)"
  exit 0
else
  echo "Result: FAIL ($FAILURES phase(s) failed)"
  exit 1
fi
