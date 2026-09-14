#!/bin/sh
set -eu
case "$(lean --version)" in
  "Lean (version 4.28.0,"*) ;;
  *) echo 'Unexpected Lean toolchain version.' >&2; exit 1 ;;
esac
cp /input/Candidate.lean /work/Candidate.lean
export LEAN_PATH=/work
lean -o Candidate.olean Candidate.lean
if [ -f /input/Final.lean ]; then
  cp /input/Final.lean /work/Final.lean
  lean -o Final.olean Final.lean
  leanchecker Final
else
  # Replay every submitted declaration against the pinned, trusted Std imports.
  leanchecker Candidate
fi
printf '\nPANOPTES_KERNEL_REPLAY_OK\n'
