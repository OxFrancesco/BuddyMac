#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createWriteStream, renameSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const release = JSON.parse(await readFile(new URL('./release.json', import.meta.url), 'utf8'));
const { version: installerVersion } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const help = `Usage: npx buddymac [--destination <folder>] [--no-open]

Installs or updates BuddyMac ${release.version} in ~/Applications and opens it.
Requires Apple Silicon, macOS 26+, and Node.js 20+.
Updates preserve settings and keep the previous app for recovery.
If BuddyMac is running, quit it when prompted to finish the update.
The download is signed and notarized by Apple. macOS download protection stays enabled.

  --destination <folder>  Install in a different folder
  --no-open               Install without opening the app
  --version               Print the installer version
  --help                  Show this help
`;

function run(command, parameters) {
  const result = spawnSync(command, parameters, { encoding: 'utf8', env: { ...process.env } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `${command} failed`);
  return result.stdout.trim();
}

const identifier = 'org.buddytools.BuddyMac';
const signingRequirement = '=anchor apple generic and certificate leaf[subject.OU] = "G2442WAF29"';
function appVersion(app) {
  const plist = join(app, 'Contents/Info.plist');
  if (run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist]) !== identifier) {
    throw new Error(`Refusing to replace an unrelated app at ${app}.`);
  }
  const version = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist]);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Unrecognized app version at ${app}: ${version}`);
  return version;
}
function compareVersions(left, right) {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function installedVersion(app) {
  if (!await exists(app)) return null;
  const info = await lstat(app);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Expected an app folder at ${app}. Move it before installing.`);
  const version = appVersion(app);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', signingRequirement, app]);
  return version;
}

const runningAppsScript = `ObjC.import('AppKit');
const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier('${identifier}');
const paths = [];
for (let i = 0; i < apps.count; i++) paths.push(ObjC.unwrap(apps.objectAtIndex(i).bundleURL.path));
JSON.stringify(paths);`;
async function isRunning(app) {
  const executable = join(app, 'Contents/MacOS/BuddyMac');
  const original = await stat(executable, { bigint: true });
  const paths = JSON.parse(run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', runningAppsScript]));
  for (const path of paths) {
    if (path === app) return true;
    try {
      const running = await stat(join(path, 'Contents/MacOS/BuddyMac'), { bigint: true });
      // App Translocation changes the device, but retains the original file identity.
      if (running.ino === original.ino && running.birthtimeNs === original.birthtimeNs &&
          (running.dev === original.dev || path.includes('/AppTranslocation/'))) return true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return false;
}
async function waitForQuit(app, signal) {
  if (!await isRunning(app)) return;
  process.stdout.write('Quit BuddyMac from its menu bar menu to finish updating. Waiting up to 2 minutes; Ctrl+C cancels.\n');
  const deadline = Date.now() + 120_000;
  while (await isRunning(app)) {
    if (Date.now() >= deadline) throw new Error('BuddyMac is still running. Nothing was replaced. Quit it and run this command again.');
    await sleep(1000, undefined, { signal });
  }
}

async function install() {
  const started = performance.now();
  let destination = join(homedir(), 'Applications');
  let open = true;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help': case '-h': process.stdout.write(help); return;
      case '--version': process.stdout.write(`${installerVersion}\n`); return;
      case '--no-open': open = false; break;
      case '--destination':
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--destination requires a folder.');
        destination = resolve(args[++i]);
        break;
      default: throw new Error(`Unknown option: ${args[i]}. Use --help.`);
    }
  }
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('BuddyMac requires an Apple Silicon Mac.');
  const macOS = run('/usr/bin/sw_vers', ['-productVersion']);
  if (Number(macOS.split('.')[0]) < 26) throw new Error(`BuddyMac requires macOS 26 or later; found ${macOS}.`);
  await mkdir(destination, { recursive: true });
  const target = join(destination, 'BuddyMac.app');
  const backup = join(destination, '.buddymac-previous.app');
  const lock = join(destination, '.buddymac-install-lock');
  const locked = spawnSync('/usr/bin/shlock', ['-f', lock, '-p', String(process.pid)], { encoding: 'utf8' });
  if (locked.error) throw locked.error;
  if (locked.status !== 0) throw new Error(`Another install may be running. If an older installer stopped, remove ${lock} and retry.`);
  let stage;
  const cancel = new AbortController();
  const onCancel = () => cancel.abort(new Error('Installation cancelled.'));
  process.on('SIGINT', onCancel);
  process.on('SIGTERM', onCancel);
  try {
    if (!await exists(target) && await exists(backup)) {
      await installedVersion(backup);
      renameSync(backup, target);
      process.stdout.write('Recovered the previous app from an interrupted update.\n');
    }
    const previousVersion = await installedVersion(target);
    if (previousVersion && compareVersions(previousVersion, release.version) >= 0) {
      process.stdout.write(`BuddyMac ${previousVersion} is already installed${previousVersion === release.version ? ' and up to date' : '; keeping the newer version'}.\n`);
      if (open) run('/usr/bin/open', [target]);
      return;
    }
    stage = await mkdtemp(join(destination, '.buddymac-'));
    const archive = join(stage, 'BuddyMac.tar.xz');
    process.stdout.write(`Downloading BuddyMac ${release.version}…\n`);
    const downloadStarted = performance.now();
    const download = spawn('/usr/bin/curl', [
      '--disable', '--fail', '--location', '--http2', '--proto', '=https', '--proto-redir', '=https',
      '--silent', '--show-error', '--connect-timeout', '20', '--max-time', '300', release.url,
    ], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'], signal: cancel.signal });
    let downloadError = '';
    download.stderr.on('data', chunk => { downloadError = (downloadError + chunk.toString()).slice(-4096); });
    const finished = new Promise((resolve, reject) => {
      download.once('error', reject);
      download.once('close', code => code === 0 ? resolve() : reject(new Error(downloadError.trim() || `Download failed: curl exited with ${code}.`)));
    });
    const total = release.bytes;
    let received = 0;
    const hash = createHash('sha256');
    const meter = new Transform({ transform(chunk, encoding, done) {
      received += chunk.length;
      hash.update(chunk);
      done(null, chunk);
    } });
    const progress = () => {
      const seconds = (performance.now() - downloadStarted) / 1000;
      const mb = (received / 1_000_000).toFixed(1);
      const size = total > 0 ? ` / ${(total / 1_000_000).toFixed(1)} MB (${Math.min(100, Math.floor(received / total * 100))}%)` : ' MB';
      const message = `${mb}${size} · ${(received / 1_000_000 / Math.max(seconds, 0.001)).toFixed(1)} MB/s · ${seconds.toFixed(0)}s`;
      process.stdout.write(process.stdout.isTTY ? `\r\x1b[2K${message}` : `${message}\n`);
    };
    const timer = setInterval(progress, process.stdout.isTTY ? 250 : 5000);
    try {
      await Promise.all([finished, pipeline(download.stdout, meter, createWriteStream(archive, { flags: 'wx' }))]);
    } finally {
      if (download.exitCode === null) download.kill();
      await finished.catch(() => {});
      clearInterval(timer);
      if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K');
    }
    if (hash.digest('hex') !== release.sha256) throw new Error('Download checksum mismatch. No app was installed.');
    process.stdout.write(`Download verified in ${((performance.now() - downloadStarted) / 1000).toFixed(1)}s. Unpacking…\n`);
    const unpackStarted = performance.now();
    run('/usr/bin/tar', ['-xJf', archive, '-C', stage]);
    const app = join(stage, 'BuddyMac.app');
    process.stdout.write(`Unpacked in ${((performance.now() - unpackStarted) / 1000).toFixed(1)}s. Checking Apple signature and notarization…\n`);
    const verificationStarted = performance.now();
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', signingRequirement, app]);
    if (appVersion(app) !== release.version) throw new Error('Downloaded app version does not match the release.');
    run('/usr/bin/xattr', ['-w', 'com.apple.quarantine', `0081;${Math.floor(Date.now() / 1000).toString(16)};BuddyMac Installer;`, app]);
    run('/usr/sbin/spctl', ['--assess', '--type', 'execute', app]);
    process.stdout.write(`Apple verification passed in ${((performance.now() - verificationStarted) / 1000).toFixed(1)}s.\n`);
    if (previousVersion) {
      await waitForQuit(target, cancel.signal);
      if (await installedVersion(target) !== previousVersion) throw new Error('The installed app changed during download. Run the installer again.');
      if (await exists(backup)) {
        await installedVersion(backup);
        await waitForQuit(backup, cancel.signal);
        await rm(backup, { recursive: true });
      }
    } else if (await exists(target)) throw new Error('An app appeared at the destination during download. Run the installer again.');
    cancel.signal.throwIfAborted();
    if (previousVersion) renameSync(target, backup);
    try { renameSync(app, target); }
    catch (error) {
      if (previousVersion) {
        try { renameSync(backup, target); }
        catch { throw new Error(`Update failed and automatic recovery could not finish. Your previous app is safe at ${backup}. Move it back to ${target}.`, { cause: error }); }
        process.stderr.write('Update failed. The previous app was restored.\n');
      }
      throw error;
    }
    process.stdout.write(`${previousVersion ? `Updated BuddyMac ${previousVersion} → ${release.version} at` : 'Installed'} ${target} in ${((performance.now() - started) / 1000).toFixed(1)}s.\n`);
    if (previousVersion) process.stdout.write(`Settings are unchanged. Previous app saved at ${backup}.\n`);
    if (open) run('/usr/bin/open', [target]);
  } finally {
    process.removeListener('SIGINT', onCancel);
    process.removeListener('SIGTERM', onCancel);
    try { if (stage) await rm(stage, { recursive: true, force: true }); }
    finally { await rm(lock, { force: true }); }
  }
}

install().catch(error => {
  process.stderr.write(`BuddyMac: ${error.message}\n`);
  process.exitCode = 1;
});
