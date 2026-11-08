#!/usr/bin/env bash
# T-30 stage reset (plan.md §22.3, owned by the IT lane): empty + warm one stack's OWN db, restart it, run smokes 3-4.
#   bash stage_reset.sh live    # LIVE: dd-live-main, service :8001, web :5173  (ask 22 to stop :8401 first)
#   bash stage_reset.sh test    # TEST: dd-live-test, service :8101, web :5174  (the rehearsal)
# Exits non-zero (and stops) on the first failed step, so a FAIL is never followed by a "ready".
set -u
STACK="${1:?live|test}"
# The laptop's layout (docs/integration-loop.md); each can be overridden from the environment.
PY="${STAGE_PY:-/c/Users/Shari/Dropbox (Personal)/GenAI Company/Projects/devday_hackathon/.venv/Scripts/python.exe}"
LAUNCH="${STAGE_LAUNCHER:-$(cd "$(dirname "$0")" && pwd -W)/live_stack.ps1}"   # the live_stack.ps1 next to this script
case "$STACK" in
  live) ROOT="${STAGE_LIVE_ROOT:-/c/Users/Shari/dd-live-main}"; SVC=8001; WEB=5173 ;;
  test) ROOT="${STAGE_TEST_ROOT:-/c/Users/Shari/dd-live-test}"; SVC=8101; WEB=5174 ;;
  *) echo "usage: stage_reset.sh live|test"; exit 2 ;;
esac
say() { echo "[$(date +%T)] $*"; }

if [ "$STACK" = live ] && netstat -ano | grep LISTENING | grep -qE "127.0.0.1:8401\b|0.0.0.0:8401\b"; then
  say "STOP: :8401 (22's public copy) still holds LIVE's db. Ask 22 to stop it first."; exit 3
fi
say "(b) stop $STACK service only (:$SVC)"
powershell -NoProfile -File "$LAUNCH" stop -Stack "$STACK" -Only service < /dev/null
t0=$(date +%s); while netstat -ano | grep LISTENING | grep -qE ":$SVC\b"; do [ $(( $(date +%s)-t0 )) -gt 15 ] && { say "FAIL: :$SVC still listening"; exit 4; }; sleep 1; done

say "(c) demo_reset.py --warm --port $SVC  (from $ROOT, resets $ROOT/data/donors.db)"
out=$(cd "$ROOT" && PYTHONIOENCODING=utf-8 "$PY" scripts/demo_reset.py --warm --port "$SVC" 2>&1); rc=$?
echo "$out" | grep -E "PASS|FAIL|stage numbers|refused|Error" | tail -8
if [ $rc -ne 0 ] || ! echo "$out" | grep -q "PASS stage numbers: 77 people / 9"; then
  say "(c) not PASS (exit $rc). Running it once more (it retries the model read)."
  out=$(cd "$ROOT" && PYTHONIOENCODING=utf-8 "$PY" scripts/demo_reset.py --warm --port "$SVC" 2>&1); rc=$?
  echo "$out" | grep -E "PASS|FAIL|stage numbers" | tail -6
  echo "$out" | grep -q "PASS stage numbers: 77 people / 9" || { say "FAIL twice: demo the receipt's counts (fallback §22.7)"; START_ANYWAY=1; }
fi

say "(d) start $STACK service"
# Not piped: the service the launcher starts inherits a pipe and would hold it open forever (seen in the dry run)
LOG="$(mktemp)"; powershell -NoProfile -File "$LAUNCH" start -Stack "$STACK" -Only service > "$LOG" 2>&1 < /dev/null; tail -1 "$LOG"

say "(e) smoke 3: health / events / public-mode on :$SVC"
h=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$SVC/health"); e=$(curl -s "http://127.0.0.1:$SVC/events"); pm=$(curl -s "http://127.0.0.1:$SVC/public-mode")
echo "  health $h | events $e | public-mode $pm"
[ "$h" = 200 ] && [ "$e" = "[]" ] && echo "$pm" | grep -q '"enabled":false' || { say "FAIL smoke 3"; exit 5; }
say "    people now: $(curl -s "http://127.0.0.1:$SVC/people" | "$PY" -c "import sys,json;print(json.load(sys.stdin)['counts'])")"

say "(e) smoke 4: web :$WEB shows Step 1 of 3, 0 console errors"
PYTHONIOENCODING=utf-8 "$PY" -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]
    pg.on('console', lambda m: m.type=='error' and errs.append(m.text[:100]))
    pg.goto('http://localhost:$WEB/'); pg.wait_for_timeout(4000)
    ok=pg.get_by_text('Step 1 of 3').count()>0 and pg.get_by_text('Drag in your').count()>0
    print('  Step 1 of 3 shown:', ok, '| console errors:', errs[:2]); b.close()
    raise SystemExit(0 if ok and not errs else 6)
" || { say "FAIL smoke 4"; exit 6; }
say "READY: $STACK is empty + warm on :$SVC/:$WEB${START_ANYWAY:+ (warm FAILED twice; see above)}"
