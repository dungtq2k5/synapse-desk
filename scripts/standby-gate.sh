#!/usr/bin/env bash
# The standby gate: a gateway standby is UP before anything relies on it.
#
#   scripts/standby-gate.sh DEPLOYMENT [TIMEOUT_SECONDS] [HOLD_SECONDS]
#
# A standby is never Ready by design (`/health/ready` answers 503 while the other
# implementation holds the lease), so `kubectl rollout status` can only time out on
# one, and CD skips it. That made a crash-looping standby invisible until the commit
# that switched traffic onto it: the cutover rehearsal's first run was a total outage
# exactly that way. Readiness cannot tell "running, not ready" from "dying"; this can.
#
# The predicate is every container of the Deployment's CURRENT ReplicaSet `started`
# with `restartCount` 0, for as many pods as the Deployment asks for, and still true
# HOLD_SECONDS later. The hold is not decoration: a container that crashes a few
# seconds after it starts is `started` and unrestarted for those seconds.
#
# Exits 0 at once for a standby at zero replicas (between switches there is nothing
# to gate), 1 if the predicate has not held by TIMEOUT_SECONDS.
set -euo pipefail

deployment=$1
timeout=${2:-300}
hold=${3:-30}

replicas=$(kubectl get "deployment/$deployment" -o jsonpath='{.spec.replicas}')
if [ "${replicas:-0}" = 0 ]; then
  echo "$deployment: standby at 0 replicas, nothing to gate"
  exit 0
fi

# 0 when every pod of the current ReplicaSet is started and has never restarted, and
# there are as many as the Deployment asks for; otherwise a one-line reason.
check() {
  kubectl get "deployment/$deployment" -o json |
    python3 -c '
import json, subprocess, sys
deployment = json.load(sys.stdin)
name = deployment["metadata"]["name"]
revision = deployment["metadata"]["annotations"]["deployment.kubernetes.io/revision"]
wanted = deployment["spec"]["replicas"]
sets = json.loads(subprocess.check_output(["kubectl", "get", "replicasets", "-o", "json"]))["items"]
current = [s for s in sets
  if any(o["name"] == name for o in s["metadata"].get("ownerReferences", []))
  and s["metadata"]["annotations"].get("deployment.kubernetes.io/revision") == revision]
if not current:
  sys.exit("no ReplicaSet at revision " + revision + " yet")
template_hash = current[0]["metadata"]["labels"]["pod-template-hash"]
pods = json.loads(subprocess.check_output(
  ["kubectl", "get", "pods", "-l", "pod-template-hash=" + template_hash, "-o", "json"]))["items"]
pods = [p for p in pods if not p["metadata"].get("deletionTimestamp")]
bad = []
for pod in pods:
  n = pod["metadata"]["name"]
  for c in pod["status"].get("containerStatuses", []) or [{"started": False, "restartCount": 0}]:
    if c["restartCount"] > 0:
      bad.append(n + " restarted " + str(c["restartCount"]) + "x")
    elif not c.get("started"):
      bad.append(n + " not started")
if len(pods) != wanted:
  bad.append(str(len(pods)) + " of " + str(wanted) + " pods")
sys.exit("; ".join(bad) if bad else 0)
'
}

deadline=$(($(date +%s) + timeout))
while :; do
  if reason=$(check 2>&1); then
    echo "$deployment: every standby pod started, none restarted; holding ${hold}s"
    sleep "$hold"
    if reason=$(check 2>&1); then
      echo "$deployment: standby is up"
      exit 0
    fi
    # A restart during the hold is the crash loop this gate exists for.
    case "$reason" in
      *restarted*)
        echo "$deployment: standby restarted during the hold: $reason" >&2
        exit 1
        ;;
    esac
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "$deployment: standby not up after ${timeout}s: $reason" >&2
    exit 1
  fi
  sleep 5
done
