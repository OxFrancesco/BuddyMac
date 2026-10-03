import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { launch } from '@gpuix/react/automation';
import { SpeechClient } from '../src/speech.ts';

const root = await mkdtemp('/private/tmp/buddymac-update-e2e-');
const destination = join(root, 'Applications');
const target = join(destination, 'BuddyMac.app');
const backup = join(destination, '.buddymac-previous.app');
const oldApp = resolve(process.argv[2] ?? `${process.env.HOME}/Applications/BuddyMac.app`);
const cli = resolve('packages/buddymac/cli.mjs');
const release = JSON.parse(await readFile(resolve('packages/buddymac/release.json')));
const out = resolve('evidence/installer-update');
await mkdir(destination); await mkdir(out, { recursive: true });
const env = { ...process.env, GPUIX_BACKGROUND: '1', LINY_MOCK: '1', BUDDYMAC_DATA_DIR: join(root, 'data'), BUDDYMAC_SPEECH_DATA_DIR: join(root, 'speech'), BUDDYMAC_FOCUS_HOME: join(root, 'focus'), BUDDYMAC_LINY_HOME: join(root, 'liny') };
function run(command, args) {
  const p = spawnSync(command, args, { encoding: 'utf8', env });
  assert.equal(p.status, 0, p.stderr); return p.stdout.trim();
}
const version = app => run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(app, 'Contents/Info.plist')]);
const oldVersion = version(oldApp);
assert.notEqual(oldVersion, release.version, 'Use an older signed app as the upgrade source.');
run('/usr/bin/ditto', [oldApp, target]);
const originalInode = (await stat(target)).ino;
const client = new SpeechClient({ dataDirectory: env.BUDDYMAC_SPEECH_DATA_DIR });
try {
  await client.savePreferences({ ...await client.preferences(), cleanupModel: 'custom/preserve-this-model' });
  await client.setWriteProvider({ kind: 'openRouter', modelID: 'custom/preserve-this-model' });
} finally { client.dispose(); }
const dataBefore = await readFile(join(env.BUDDYMAC_SPEECH_DATA_DIR, 'settings.json'), 'utf8');
const checks = [];
const frames = [];
let app;
const children = new Set();
async function openFixture(name) {
  app = await launch({ command: join(target, 'Contents/MacOS/BuddyMac'), args: [], env });
  await app.getByTestId('nav-Talk').click();
  await app.getByTestId('talk-tab-settings').click();
  await app.getByTestId('talk-cleanup-model').waitFor();
  await Bun.sleep(700);
  const path = join(out, `${name}.png`);
  await app.screenshot({ path }); frames.push(path);
}
function install(label, entry = cli) {
  let output = '';
  const child = spawn('node', [entry, '--destination', destination, '--no-open'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', async code => { children.delete(child); await writeFile(join(out, `${label}.log`), output); resolve({ code, output }); });
  });
  return { child, done, async waiting() {
    const deadline = Date.now() + 120_000;
    while (!output.includes('Quit BuddyMac from its menu bar')) {
      if (child.exitCode !== null) throw new Error(output);
      assert(Date.now() < deadline, 'Installer must reach the quit prompt');
      await Bun.sleep(100);
    }
  } };
}
async function cleanTransaction() {
  assert.deepEqual((await readdir(destination)).filter(name => name.startsWith('.buddymac-') && name !== '.buddymac-previous.app'), []);
}
try {
  await openFixture('before-update');
  const cancelled = install('cancel'); await cancelled.waiting();
  const concurrent = await install('concurrent').done;
  assert.equal(concurrent.code, 1); assert(concurrent.output.includes('Another install may be running'));
  cancelled.child.kill('SIGINT'); assert.equal((await cancelled.done).code, 1);
  assert.equal((await stat(target)).ino, originalInode); await cleanTransaction();
  checks.push('Cancellation and concurrent install leave the running old app untouched');

  const failed = install('rollback'); await failed.waiting();
  const stage = (await readdir(destination)).find(name => /^\.buddymac-[a-zA-Z0-9]{6}$/.test(name));
  assert(stage);
  await rename(join(destination, stage, 'BuddyMac.app'), join(root, 'withheld-new-app'));
  await app.close(); app = undefined;
  const rolledBack = await failed.done;
  assert.equal(rolledBack.code, 1); assert(rolledBack.output.includes('previous app was restored'));
  assert.equal((await stat(target)).ino, originalInode); assert.equal(version(target), oldVersion);
  await cleanTransaction(); checks.push('A real filesystem replacement failure restores the old signed app');

  await openFixture('after-rollback');
  const update = install('upgrade'); await update.waiting();
  assert.equal(version(target), oldVersion);
  await app.close(); app = undefined;
  assert.equal((await update.done).code, 0);
  assert.equal(version(target), release.version); assert.equal(version(backup), oldVersion);
  assert.equal(await readFile(join(env.BUDDYMAC_SPEECH_DATA_DIR, 'settings.json'), 'utf8'), dataBefore);
  run('/usr/sbin/spctl', ['--assess', '--type', 'execute', target]);
  checks.push(`Real ${oldVersion} to ${release.version} upgrade waits for quit, passes Gatekeeper and preserves settings`);
  await openFixture('after-update'); await app.close(); app = undefined;

  const installedInode = (await stat(target)).ino;
  const repeat = await install('repeat').done;
  assert.equal(repeat.code, 0); assert(repeat.output.includes('up to date')); assert(!repeat.output.includes('Downloading'));
  assert.equal((await stat(target)).ino, installedInode);
  checks.push('Re-running on the latest app skips download and replacement');

  const invalidPackage = join(root, 'invalid-package');
  await cp(resolve('packages/buddymac'), invalidPackage, { recursive: true });
  const manifest = JSON.parse(await readFile(join(invalidPackage, 'release.json')));
  const nextVersion = release.version.replace(/\d+$/, patch => String(Number(patch) + 1));
  await writeFile(join(invalidPackage, 'release.json'), JSON.stringify({ ...manifest, version: nextVersion, sha256: '0'.repeat(64) }));
  const rejected = await install('bad-checksum', join(invalidPackage, 'cli.mjs')).done;
  assert.equal(rejected.code, 1); assert(rejected.output.includes('checksum mismatch'));
  assert.equal((await stat(target)).ino, installedInode);
  checks.push('Rejected download leaves the installed app unchanged');

  await rm(backup, { recursive: true }); await rename(target, backup);
  const exited = spawnSync('/usr/bin/true', [], { env });
  assert.equal(exited.status, 0);
  assert.throws(() => process.kill(exited.pid, 0), { code: 'ESRCH' });
  await writeFile(join(destination, '.buddymac-install-lock'), `${exited.pid}\n`);
  await Bun.sleep(1500);
  const recovery = await install('interrupted').done;
  assert.equal(recovery.code, 0); assert(recovery.output.includes('Recovered the previous app'));
  assert.equal((await stat(target)).ino, installedInode); await cleanTransaction();
  checks.push('A stale process lock and interrupted replacement recover on the next run');

  await writeFile(join(out, 'result.json'), JSON.stringify({ root, oldApp, target, checks, limits: ['Tests use isolated app and data folders. No real user app was stopped or updated.', 'No live microphone or AI calls were made.'] }, null, 2));
  const list = join(out, 'frames.txt');
  await writeFile(list, frames.map(path => `file '${path}'\nduration 2`).join('\n') + `\nfile '${frames.at(-1)}'\n`);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'scale=1080:-2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'upgrade.mp4')]);
  console.log(JSON.stringify({ passed: checks.length, root, checks }));
} finally {
  for (const child of children) child.kill('SIGINT');
  if (app) await app.close();
}
