#!/usr/bin/env bash
# Read-only observation of a public ZKsync EraVM network (default: ZKsync Era Sepolia, chain 300).
# Records the raw JSON-RPC answers that identify the active protocol version and fee parameters.
# No key, no account, no transaction: only eth_/zks_ read methods. Run on the campaign host (curl only):
#   ./chainbench/adapters/eravm/observe-public.sh [endpoint] [label]
# Output: build/chainbench/l2/observations/<UTC>/  (one <name>.json raw answer per call, calls.tsv, meta.txt)
set -uo pipefail
EP=${1:-https://sepolia.era.zksync.dev}
LABEL=${2:-ZKsync Era Sepolia official public RPC (Matter Labs), https://sepolia.era.zksync.dev}
REPO=$(cd "$(dirname "$0")/../../.." && pwd -P)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$REPO/build/chainbench/l2/observations/$STAMP"
mkdir -p "$OUT"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
call() {  # name method params-json
  local t0 t1 code body
  body="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$2\",\"params\":$3}"
  t0=$(now)
  code=$(curl -sS --max-time 30 -o "$OUT/$1.json" -w '%{http_code}' -H 'content-type: application/json' --data "$body" "$EP" 2>"$OUT/$1.err") || code=000
  t1=$(now)
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$t0" "$t1" "$code" >>"$OUT/calls.tsv"
  printf '%-18s %-28s HTTP %s  %s\n' "$1" "$2" "$code" "$(head -c 160 "$OUT/$1.json" 2>/dev/null)"
}
hexfield() { sed -n 's/.*"result":"0x\([0-9a-fA-F]*\)".*/\1/p' "$OUT/$1.json" | head -1; }
{ printf 'endpoint\t%s\nlabel\t%s\nstarted_utc\t%s\nhost\t%s %s\ncurl\t%s\n' "$EP" "$LABEL" "$(now)" "$(uname -s)" "$(uname -r)" "$(curl --version | head -1)"; } >"$OUT/meta.txt"
printf 'name\tmethod\tparams\tt_request_utc\tt_response_utc\thttp\n' >"$OUT/calls.tsv"
echo "read-only observation of $EP -> ${OUT#"$REPO"/}"
call chainId            eth_chainId            '[]'
call clientVersion      web3_clientVersion     '[]'
call protocolVersion    zks_getProtocolVersion '[]'
call feeParams          zks_getFeeParams       '[]'
call gasPrice           eth_gasPrice           '[]'
call blockNumber        eth_blockNumber        '[]'
call latestBlock        eth_getBlockByNumber   '["latest",false]'
call l1BatchNumber      zks_L1BatchNumber      '[]'
bn=$(hexfield blockNumber); [ -n "$bn" ] && call blockDetails zks_getBlockDetails "[$((16#$bn))]"
lb=$(hexfield l1BatchNumber); [ -n "$lb" ] && call l1BatchDetails zks_getL1BatchDetails "[$((16#$lb))]"
[ -n "$lb" ] && [ "$((16#$lb))" -gt 1 ] && call l1BatchDetailsPrev zks_getL1BatchDetails "[$((16#$lb - 1))]"
call bridgeContracts    zks_getBridgeContracts '[]'
printf 'finished_utc\t%s\n' "$(now)" >>"$OUT/meta.txt"
echo "done: ${OUT#"$REPO"/} (send nothing else; no transaction was made)"
