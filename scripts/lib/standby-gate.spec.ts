import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `scripts/standby-gate.sh`, against a fake `kubectl` that replays what a cluster
 * would answer: a deployment, its current ReplicaSet, and one pod state per
 * `get pods` call, so a pod can look healthy on the first look and restarted on
 * the second, which is the crash loop the gate exists to catch.
 */

type Pod = { name: string; started: boolean; restarts: number };

const GATE = join(__dirname, '..', 'standby-gate.sh');

const FAKE_KUBECTL = `#!/usr/bin/env node
const fs = require('node:fs');
const scenario = JSON.parse(fs.readFileSync(process.env.SCENARIO, 'utf8'));
const args = process.argv.slice(2).join(' ');
if (args.includes('jsonpath={.spec.replicas}')) {
  process.stdout.write(String(scenario.replicas));
} else if (args.startsWith('get deployment/')) {
  process.stdout.write(JSON.stringify({
    metadata: { name: 'api-gateway-java', annotations: { 'deployment.kubernetes.io/revision': '7' } },
    spec: { replicas: scenario.replicas },
  }));
} else if (args.startsWith('get replicasets')) {
  process.stdout.write(JSON.stringify({ items: [
    { metadata: { ownerReferences: [{ name: 'api-gateway-java' }], annotations: { 'deployment.kubernetes.io/revision': '6' }, labels: { 'pod-template-hash': 'old' } } },
    { metadata: { ownerReferences: [{ name: 'api-gateway-java' }], annotations: { 'deployment.kubernetes.io/revision': '7' }, labels: { 'pod-template-hash': 'current' } } },
  ] }));
} else if (args.startsWith('get pods -l pod-template-hash=current')) {
  const counter = process.env.SCENARIO + '.calls';
  const call = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
  fs.writeFileSync(counter, String(call + 1));
  const pods = scenario.pods[Math.min(call, scenario.pods.length - 1)];
  process.stdout.write(JSON.stringify({ items: pods.map((p) => ({
    metadata: { name: p.name },
    status: { containerStatuses: [{ name: 'api-gateway-java', started: p.started, restartCount: p.restarts }] },
  })) }));
} else {
  process.stderr.write('fake kubectl: unexpected ' + args);
  process.exit(2);
}
`;

function gate(scenario: { replicas: number; pods: Pod[][] }) {
  const dir = mkdtempSync(join(tmpdir(), 'standby-gate-'));
  writeFileSync(join(dir, 'kubectl'), FAKE_KUBECTL);
  chmodSync(join(dir, 'kubectl'), 0o755);
  const file = join(dir, 'scenario.json');
  writeFileSync(file, JSON.stringify(scenario));

  // A one-second timeout and hold: the loop's own cadence is not under test.
  return spawnSync('bash', [GATE, 'api-gateway-java', '1', '1'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SCENARIO: file },
  });
}

const up = (name: string): Pod => ({ name, started: true, restarts: 0 });

describe('the standby gate', () => {
  it('passes two pods that started and stayed up through the hold', () => {
    const result = gate({ replicas: 2, pods: [[up('a'), up('b')]] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('standby is up');
  });

  it('**fails a pod that restarts during the hold**: started a moment, then crashed', () => {
    const result = gate({
      replicas: 2,
      pods: [
        [up('a'), up('b')],
        [up('a'), { name: 'b', started: true, restarts: 1 }],
      ],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('b restarted 1x');
  });

  it('fails a standby whose pods never start', () => {
    const result = gate({
      replicas: 2,
      pods: [[up('a'), { name: 'b', started: false, restarts: 0 }]],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('b not started');
  });

  it('fails a standby with fewer pods than it asks for', () => {
    const result = gate({ replicas: 2, pods: [[up('a')]] });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('1 of 2 pods');
  });

  it('passes at once a standby at zero replicas: there is nothing to gate', () => {
    const result = gate({ replicas: 0, pods: [[]] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('nothing to gate');
  });
});
