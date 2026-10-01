#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const release = JSON.parse(await readFile(new URL('./release.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const help = `Usage: npx buddymac [--destination <folder>] [--no-open]

Installs BuddyMac ${release.version} to ~/Applications and opens it.
Requires Apple Silicon, macOS 26+, and Node.js 20+.
Existing apps are never overwritten. Quit and move an old copy before updating.
This early build is signed but not notarized. macOS may require Open Anyway
in System Settings > Privacy & Security after the first launch attempt.

  --destination <folder>  Install in a different folder
  --no-open               Install without opening the app
  --version               Print the bundled release version
  --help                  Show this help
`;

function run(command, parameters) {
  const result = spawnSync(command, parameters, { encoding: 'utf8', env: { ...process.env } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `${command} failed`);
  return result.stdout.trim();
}

async function install() {
  let destination = join(homedir(), 'Applications');
  let open = true;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help': case '-h': process.stdout.write(help); return;
      case '--version': process.stdout.write(`${release.version}\n`); return;
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
  const lock = join(destination, '.buddymac-install-lock');
  await mkdir(lock).catch(error => {
    if (error.code === 'EEXIST') throw new Error(`Another install may be running. If it stopped, remove ${lock} and retry.`);
    throw error;
  });
  let stage;
  try {
    try {
      await access(target);
      throw new Error(`${target} already exists. Quit BuddyMac and move that copy before installing, or choose another --destination.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    stage = await mkdtemp(join(destination, '.buddymac-'));
    const archive = join(stage, 'BuddyMac.zip');
    process.stdout.write(`Downloading BuddyMac ${release.version}…\n`);
    const response = await fetch(release.url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}. ${release.url}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { flags: 'wx' }));
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    if (hash.digest('hex') !== release.sha256) throw new Error('Download checksum mismatch. No app was installed.');
    run('/usr/bin/ditto', ['-x', '-k', archive, stage]);
    const app = join(stage, 'BuddyMac.app');
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', '=anchor apple generic and certificate leaf[subject.OU] = "G2442WAF29"', app]);
    const identifier = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(app, 'Contents/Info.plist')]);
    if (identifier !== 'org.buddytools.BuddyMac') throw new Error('Unexpected application identifier.');
    run('/usr/bin/xattr', ['-w', 'com.apple.quarantine', `0081;${Math.floor(Date.now() / 1000).toString(16)};BuddyMac Installer;`, app]);
    await rename(app, target);
    process.stdout.write(`Installed ${target}\nThis build is not notarized. If macOS blocks it, use System Settings > Privacy & Security > Open Anyway.\n`);
    if (open) run('/usr/bin/open', [target]);
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

install().catch(error => {
  process.stderr.write(`BuddyMac: ${error.message}\n`);
  process.exitCode = 1;
});
