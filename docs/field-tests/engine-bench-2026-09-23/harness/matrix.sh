#!/usr/bin/env bash
# Interleaved matrix: every rep runs each config line once, in file order (A, B, C, A, B, C…),
# so load from anything else on the machine lands on every config alike.
#
#   matrix.sh <configs-file> <reps> "<common bench query>"
#
# Config line: <tauri|wk|chrome> <label> [ENV=VAL ...] [-- engine args]. `#` starts a comment;
# @BENCH_DIR@ and @HARNESS@ are replaced with the bench and harness directories.
HERE=$(cd "$(dirname "$0")" && pwd)
BENCH_DIR=${BENCH_DIR:-${XDG_RUNTIME_DIR:-/tmp}/pt-engine-bench}
cfg=$1; reps=$2; query=$3
for rep in $(seq 1 "$reps"); do
  while read -r line; do
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    line=${line//@BENCH_DIR@/$BENCH_DIR}
    line=${line//@HARNESS@/$HERE}
    read -r -a parts <<< "$line"
    envs=(); args=(); seen=0
    for p in "${parts[@]:2}"; do
      if [ "$seen" = 1 ]; then args+=("$p"); elif [ "$p" = "--" ]; then seen=1; else envs+=("$p"); fi
    done
    echo "### rep $rep: ${parts[0]} ${parts[1]}"
    "$HERE/run-one.sh" "${parts[0]}" "${parts[1]}" --q "$query&rep=$rep" "${envs[@]}" -- "${args[@]}"
    sleep 5
  done < "$cfg"
done
echo "### matrix $cfg done $(date +%T)"
