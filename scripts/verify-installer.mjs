import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const version = process.argv[2];
assert(version && /^\d+\.\d+\.\d+$/.test(version), 'Pass the exact npm version, optionally followed by a packed .tgz path.');
const packed = process.argv[3] ? resolve(process.argv[3]) : undefined;
const source = packed ?? `buddymac@${version}`;
const root = await mkdtemp('/private/tmp/buddymac-cold-install-');
const cache = join(root, 'npm-cache');
const destination = join(root, 'Applications');
await mkdir(cache);
assert.deepEqual(await readdir(cache), []);
const evidence = resolve('evidence/installer');
await mkdir(evidence, { recursive: true });
const started = performance.now();
const child = spawn('npx', ['--yes', '--prefer-online', '--cache', cache, '--package', source, '--', 'buddymac', '--destination', destination, '--no-open'], {
  cwd: root, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
  output += chunk.toString(); process.stdout.write(chunk);
});
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
const totalSeconds = (performance.now() - started) / 1000;
const label = `cold-${version}${packed ? '-packed' : ''}`;
await writeFile(join(evidence, `${label}.log`), output);
const result = { version, source, root, cacheStartedEmpty: true, totalSeconds, exitCode: code, app: join(destination, 'BuddyMac.app') };
await writeFile(join(evidence, `${label}.json`), JSON.stringify(result, null, 2));
assert.equal(code, 0, 'The published installer must complete successfully.');
assert(output.includes('Apple verification passed'), 'Gatekeeper must accept the downloaded app.');
console.log(JSON.stringify(result));
