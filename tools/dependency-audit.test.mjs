import assert from 'node:assert/strict';
import { test } from 'vitest';
import { classifyAudit } from './dependency-audit.mjs';

const grpc = '@grpc/grpc-js';
const firestore = '@firebase/firestore';
const advisory = (id, dependency = grpc, severity = 'high') =>
  ({ dependency, severity, url: `https://github.com/advisories/${id}` });

function fixture() {
  const vulnerabilities = {
    [grpc]: { name: grpc, severity: 'high', nodes: [`node_modules/${grpc}`], via: [
      advisory('GHSA-m9gg-hp2v-232j'), advisory('GHSA-f596-whhp-79r4', grpc, 'low'),
    ] },
    [firestore]: { name: firestore, severity: 'high', nodes: [`node_modules/${firestore}`], via: [grpc] },
  };
  const report = { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: { total: 2 } } };
  const packages = { [`node_modules/${grpc}`]: { version: '1.9.16' }, [`node_modules/${firestore}`]: { version: '4.19.1' } };
  return { report, packages };
}

test('accepts the documented advisories only for reviewed versions until the review date', () => {
  const { report, packages } = fixture();
  const classify = (now = Date.parse('2026-11-26')) => classifyAudit(report, 1, packages, true, now).map(item => item.outcome);
  assert.ok(classify().every(outcome => outcome.startsWith('accepted')));
  assert.deepEqual(classify(Date.parse('2027-02-26')), ['blocked', 'blocked']);
  packages[`node_modules/${grpc}`].version = '1.9.17';
  assert.deepEqual(classify(), ['blocked', 'blocked']);
});

test('blocks a new advisory on the same node and its inherited findings', () => {
  const { report, packages } = fixture();
  report.vulnerabilities[grpc].via.push(advisory('GHSA-new'));
  assert.deepEqual(classifyAudit(report, 1, packages, true, Date.parse('2026-11-26')).map(item => item.outcome), ['blocked', 'blocked']);
});

test('reports development moderate findings and blocks production moderate findings', () => {
  const { report, packages } = fixture();
  delete report.vulnerabilities[firestore];
  report.metadata.vulnerabilities.total = 1;
  report.vulnerabilities[grpc].severity = 'moderate';
  report.vulnerabilities[grpc].via = [advisory('GHSA-other', grpc, 'moderate')];
  assert.equal(classifyAudit(report, 1, packages, false)[0].outcome, 'reported');
  assert.equal(classifyAudit(report, 1, packages, true)[0].outcome, 'blocked');
});

test('rejects a registry error, incomplete report or inconsistent npm status', () => {
  const { report, packages } = fixture();
  for (const bad of [{ error: { code: 'E503' } }, { ...report, vulnerabilities: null }, report]) {
    assert.throws(() => classifyAudit(bad, 0, packages, true), /usable registry report/);
  }
});
