#!/usr/bin/env bash
# Build and run the small VM that diagnoses Windows→Linux Ctrl+V paste.
#
# The VM is a headless Linux "remote host" (Docker container). It runs the real
# PrioriCode paste modules and prints a diagnosis matrix + root cause.
#
# Usage:
#   bash vm/run.sh                 # build + run the VM
#   PC_PASTE_IMAGE=my-tag bash vm/run.sh   # custom image tag
#
# No Docker? Run the same diagnosis locally (bun required):
#   bun vm/diagnose.ts
set -euo pipefail

# Build context must be the repo root so the Dockerfile can COPY packages/tui/src/*.
cd "$(dirname "$0")/.."

IMAGE="${PC_PASTE_IMAGE:-pc-paste-diag}"

echo ">> Building small VM image: ${IMAGE}"
docker build -q -f vm/Dockerfile -t "${IMAGE}" .

echo ">> Running the headless Linux remote host (simulating a Windows client)…"
docker run --rm "${IMAGE}"
