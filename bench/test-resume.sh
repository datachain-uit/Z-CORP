#!/bin/bash
# Engineering test of round-level resume (reduced dry run, plan "resumetest"; timings are not
# interpreted). Run on the campaign host from the repository root:
#
#   bash bench/test-resume.sh
#
# 1. session 1: new reduced dry run, clean planned stop after one accepted round;
# 2. session 2: resume; the accepted round is skipped; a crash is simulated inside the next round;
# 3. session 3: resume; the interrupted attempt is preserved as "incomplete" and that whole round
#    is rerun as a new attempt; the remaining rounds complete; final validation;
# 4. a direct harness call for the accepted round must be refused without new rows;
# 5. a resume of a copy whose schedule was altered, and of a copy whose campaign record names
#    another git commit, must be refused;
# 6. bench/check_resume_test.js checks the whole history.
set -u
KIT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$KIT/.." && pwd)"
ID="dryrun-resumetest-$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$REPO/build/campaigns/$ID"
say() { echo; echo "######## $*"; }
COMPOSE="docker compose -f $KIT/compose.yaml"
[ -n "${ZCORP_COMPOSE_OVERRIDE:-}" ] && COMPOSE="$COMPOSE -f $ZCORP_COMPOSE_OVERRIDE"

say "session 1: new reduced dry run, stop after one accepted round"
ZCORP_CAMPAIGN_ID="$ID" ZCORP_STOP_AFTER_ROUNDS=1 bash "$KIT/run-campaign.sh" dryrun --plan resumetest
rc1=$?; echo "session 1 exit $rc1"; [ $rc1 -eq 0 ] || { echo "RESUME TEST FAIL: session 1"; exit 1; }

say "session 2: resume, simulated interruption inside the next round"
ZCORP_TEST_INTERRUPT_AFTER_CONTAINERS=1 bash "$KIT/run-campaign.sh" resume "$OUT"
rc2=$?; echo "session 2 exit $rc2 (3 = simulated interruption)"; [ $rc2 -eq 3 ] || { echo "RESUME TEST FAIL: session 2"; exit 1; }

say "session 3: resume to the end"
bash "$KIT/run-campaign.sh" resume "$OUT"
rc3=$?; echo "session 3 exit $rc3"; [ $rc3 -eq 0 ] || { echo "RESUME TEST FAIL: session 3"; exit 1; }

say "refusal checks"
mkdir -p "$OUT/environment/resume-test"
F="$OUT/environment/resume-test/refusal.txt"
count_rows() { cat "$OUT"/prover/*/runs.csv "$OUT"/prover/*/rounds.csv 2>/dev/null | wc -l | tr -d ' '; }
IMG=$(sed -n 's/.*"built_image_id": "\([^"]*\)".*/\1/p' "$OUT/CAMPAIGN.json" | head -1)
FIRST_PROFILE=$(sed -n '2p' "$OUT/prover/schedule.csv" | cut -d, -f4)
before=$(count_rows)
ZCORP_IMAGE="zcorp-bench:$ID" ZCORP_IMAGE_ID="$IMG" ZCORP_REPO="$REPO" ZCORP_RESULTS="$OUT" ZCORP_SESSION_ID=SREFUSALTEST \
  $COMPOSE run --rm -T "$FIRST_PROFILE" node --expose-gc /opt/zcorp/harness.js --kind primary --round 0 --attempt 2 </dev/null \
  2> "$OUT/environment/resume-test/harness-refusal.err"
hx=$?
cat "$OUT/environment/resume-test/harness-refusal.err"
after=$(count_rows)
{ echo "harness_exit=$hx"; echo "rows_before=$before"; echo "rows_after=$after"; } > "$F"
T="$REPO/build/campaigns/$ID-tampered"
cp -R "$OUT" "$T"
# alter one frozen configuration order (first ';' separator of the first schedule row)
awk 'NR==2{sub(/;/,"|")} {print}' "$T/prover/schedule.csv" > "$T/prover/schedule.csv.new" && mv "$T/prover/schedule.csv.new" "$T/prover/schedule.csv"
bash "$KIT/run-campaign.sh" resume "$T" > "$OUT/environment/resume-test/tamper.log" 2>&1
tx=$?
grep -q "REFUSE" "$OUT/environment/resume-test/tamper.log" && tr=yes || tr=no
{ echo "tamper_exit=$tx"; echo "tamper_refused=$tr"
  echo "tamper_reason=$(grep -m1 -o 'REFUSE.*' "$OUT/environment/resume-test/tamper.log" | tr '=,' '  ')"; } >> "$F"
# a copy whose campaign record names another git commit must be refused by the runner's identity check
T2="$REPO/build/campaigns/$ID-othercommit"
cp -R "$OUT" "$T2"
sed 's/"commit": "[0-9a-f]*"/"commit": "0000000000000000000000000000000000000000"/' "$OUT/CAMPAIGN.json" > "$T2/CAMPAIGN.json"
bash "$KIT/run-campaign.sh" resume "$T2" > "$OUT/environment/resume-test/othercommit.log" 2>&1
cx=$?
{ echo "commit_tamper_exit=$cx"
  echo "commit_tamper_reason=$(grep -m1 -o 'REFUSE.*' "$OUT/environment/resume-test/othercommit.log" | tr '=,' '  ')"; } >> "$F"
cat "$F"

say "checking the resume history"
ZCORP_IMAGE="zcorp-bench:$ID" ZCORP_IMAGE_ID="$IMG" ZCORP_REPO="$REPO" ZCORP_RESULTS="$OUT" ZCORP_SESSION_ID= \
  $COMPOSE run --rm -T tools node /opt/zcorp/check_resume_test.js </dev/null
rc=$?
echo
[ $rc -eq 0 ] && echo "RESUME TEST: PASS ($OUT)" || echo "RESUME TEST: FAIL ($OUT)"
exit $rc
