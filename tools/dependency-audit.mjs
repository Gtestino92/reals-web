import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const grpc = '@grpc/grpc-js';
const firestore = '@firebase/firestore';
const compat = '@firebase/firestore-compat';
const acceptedChain = {
  [grpc]: { version: '1.9.16', severity: 'high' },
  [firestore]: { version: '4.19.1', severity: 'high' },
  [compat]: { version: '0.4.17', severity: 'high' },
  firebase: { version: '13.2.0', severity: 'high' },
};
const acceptedAdvisories = new Map([
  ['https://github.com/advisories/GHSA-m9gg-hp2v-232j', 'high'],
  ['https://github.com/advisories/GHSA-f596-whhp-79r4', 'low'],
]);
const severity = ['info', 'low', 'moderate', 'high', 'critical'];
// The app uses only Firebase Auth/App Check. Review the Node server exposure and
// upstream pin before renewing. See docs/security-technical-debt.md section 8.
const reviewBy = '2027-02-26T00:00:00Z';

export function classifyAudit(report, status, packages, production, now = Date.now()) {
  const entries = Object.entries(report?.vulnerabilities ?? {});
  if (report?.error || report?.auditReportVersion !== 2 || !report.vulnerabilities ||
      typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities) ||
      report.metadata?.vulnerabilities?.total !== entries.length ||
      status !== (entries.length ? 1 : 0) ||
      entries.some(([name, entry]) => entry?.name !== name || !severity.includes(entry.severity) ||
        !Array.isArray(entry.nodes) || !entry.nodes.length || entry.nodes.some(node => !Object.hasOwn(packages, node)) ||
        !Array.isArray(entry.via) || !entry.via.length || entry.via.some(via => typeof via === 'string'
          ? !Object.hasOwn(report.vulnerabilities, via)
          : via?.dependency !== name || typeof via.url !== 'string' || !severity.includes(via.severity)))) {
    throw new Error('npm audit did not return a usable registry report');
  }

  const accepted = (name, visited = []) => {
    if (now >= Date.parse(reviewBy) || visited.includes(name) || !Object.hasOwn(acceptedChain, name)) return false;
    const entry = report.vulnerabilities[name];
    const rule = acceptedChain[name];
    const node = `node_modules/${name}`;
    if (entry.severity !== rule.severity || entry.nodes.length !== 1 ||
        entry.nodes[0] !== node || packages[node].version !== rule.version) return false;
    return entry.via.every(via => {
      if (typeof via !== 'string') return name === grpc && acceptedAdvisories.get(via.url) === via.severity;
      const knownEdge = name === 'firebase' && (via === firestore || via === compat) ||
        name === compat && via === firestore || name === firestore && via === grpc;
      return knownEdge && accepted(via, [...visited, name]);
    });
  };

  return entries.map(([name, entry]) => ({
    name, severity: entry.severity, via: entry.via.map(via => typeof via === 'string' ? via : via.url),
    outcome: accepted(name) ? 'accepted (review by ' + reviewBy.slice(0, 10) + ')' :
      severity.indexOf(entry.severity) >= severity.indexOf(production ? 'moderate' : 'high') ? 'blocked' : 'reported',
  }));
}

function run() {
  const { packages } = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  let exitCode = 0;
  for (const [label, flag] of [['Production', '--omit=dev'], ['Full (including dev)', '--include=dev']]) {
    try {
      const args = ['audit', '--package-lock-only', flag, '--json', '--audit-level=info'];
      const options = { encoding: 'utf8', timeout: 90_000 };
      // On Windows npm is a .cmd shim. All command arguments are constants.
      const result = process.platform === 'win32'
        ? spawnSync(`npm ${args.join(' ')}`, { ...options, shell: true })
        : spawnSync('npm', args, options);
      if (result.error) throw result.error;
      const findings = classifyAudit(JSON.parse(result.stdout), result.status, packages, flag === '--omit=dev');
      console.log(`${label}: ${findings.length} package findings (advisories may be inherited)`);
      for (const { name, severity, via, outcome } of findings) {
        console.log(`  ${severity} ${name}: ${outcome} via ${via.join(', ')}`);
        if (outcome === 'blocked') exitCode = Math.max(exitCode, 1);
      }
    } catch {
      console.error(`${label}: scanner or registry failure. No reliable vulnerability result.`);
      exitCode = 2;
    }
  }
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
