import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { chmod, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";

export interface DockApp {
  id: string;
  name: string;
  appPath: string;
  bundleIdentifier: string | null;
  iconPath: string;
}
export interface SavedDockIcon extends DockApp {
  styledIconPath: string;
  applyMethod: "finder" | "ghostty" | "external";
}
export interface SavedDockPack {
  path: string;
  theme: string;
  icons: SavedDockIcon[];
}
export interface DockResult {
  appPath: string;
  applied: boolean;
  running: boolean;
  changed: boolean;
  error: string | null;
}

export function dockFailureMessage(results: readonly DockResult[]): string {
  const failure = results.find(result => result.error);
  if (!failure?.error) return '';
  const name = failure.appPath.split('/').at(-1)?.replace(/\.app$/, '') ?? failure.appPath;
  return failure.error.includes('App Management')
    ? `App Management is blocking icon changes for ${name}.`
    : `${name}: ${failure.error}`;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid Dock data");
  return Object.fromEntries(Object.entries(value));
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected text in Dock data");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Expected boolean in Dock data");
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected a list in Dock data");
  return value;
}
function parseApp(value: unknown): DockApp {
  const item = record(value);
  return { id: string(item.id), name: string(item.name), appPath: string(item.appPath),
    bundleIdentifier: item.bundleIdentifier === null ? null : string(item.bundleIdentifier), iconPath: string(item.iconPath) };
}
function parseResult(value: unknown): DockResult {
  const item = record(value);
  return { appPath: string(item.appPath), applied: boolean(item.applied), running: boolean(item.running),
    changed: boolean(item.changed), error: item.error == null ? null : string(item.error) };
}

async function helper(name: string, args: string[], input?: unknown): Promise<unknown> {
  const directory = process.env.BUDDYMAC_NATIVE_DIR ?? (process.execPath.includes(".app/Contents/MacOS/")
    ? dirname(process.execPath) : resolve(dirname(import.meta.path), "../dist/native"));
  const binary = resolve(directory, name);
  const child = Bun.spawn([binary, ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: process.env });
  if (input !== undefined) child.stdin.write(JSON.stringify(input));
  child.stdin.end();
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(err.trim() || `Dock helper exited with ${code}`);
  return JSON.parse(out);
}

export async function listDockApps(): Promise<DockApp[]> {
  const output = resolve(process.env.BUDDYMAC_DATA_DIR ?? resolve(homedir(), "Library/Application Support/BuddyMac"), "Dock/icons");
  await mkdir(output, { recursive: true, mode: 0o700 });
  return array(await helper("buddymac-dock-inspector", [output])).map(parseApp);
}

export async function loadSavedDockPack(path = process.env.BUDDYMAC_LEGACY_DOCK_MANIFEST ?? resolve(homedir(), "Library/Application Support/BuddyDock/active-manifest.json")): Promise<SavedDockPack | null> {
  if (!await Bun.file(path).exists()) return null;
  const data = record(await Bun.file(path).json());
  if (data.version !== 1) throw new Error("Unsupported Dock pack version");
  return { path, theme: string(data.theme), icons: array(data.icons).map(value => {
    const item = record(value);
    const app = parseApp(value);
    const method = item.applyMethod ?? (app.bundleIdentifier === "com.mitchellh.ghostty" ? "ghostty" : "finder");
    if (method !== "finder" && method !== "ghostty" && method !== "external") throw new Error("Unsupported Dock icon method");
    return { ...app, appPath: resolve(dirname(path), app.appPath), iconPath: resolve(dirname(path), app.iconPath),
      styledIconPath: resolve(dirname(path), string(item.styledIconPath)), applyMethod: method };
  }) };
}

export async function dockStatus(pack: SavedDockPack): Promise<DockResult[]> {
  const finder = pack.icons.filter(icon => icon.applyMethod === "finder");
  const results = finder.length === 0 ? [] : array(await helper("buddymac-dock-applier", ["status"], finder.map(icon => ({ appPath: icon.appPath, iconPath: icon.styledIconPath })))).map(parseResult);
  return pack.icons.map(icon => results.find(result => result.appPath === icon.appPath) ?? {
    appPath: icon.appPath, applied: false, running: false, changed: false,
    error: "This icon uses the application's own settings. Finder icon status does not apply.",
  });
}

export async function applyDockIcons(pack: SavedDockPack, appPaths: readonly string[]): Promise<DockResult[]> {
  if (!appPaths.length) throw new Error("Select at least one application");
  const selected = [...new Set(appPaths)].map(path => {
    const icon = pack.icons.find(item => item.appPath === path);
    if (!icon) throw new Error(`No saved icon for ${path}`);
    if (icon.applyMethod !== "finder") throw new Error(`${icon.name} uses its own icon settings`);
    return { appPath: icon.appPath, iconPath: icon.styledIconPath };
  });
  return array(await helper("buddymac-dock-applier", ["apply-missing"], selected)).map(parseResult);
}

function managedDirectory(): string {
  return resolve(process.env.BUDDYMAC_DATA_DIR ?? resolve(homedir(), "Library/Application Support/BuddyMac"), "Dock");
}

export const getManaged = () => loadSavedDockPack(resolve(managedDirectory(), "managed.json"));

export async function iconPreview(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!await file.exists() || new TextDecoder().decode(await file.slice(0, 4).arrayBuffer()) !== "icns") return path;
  const directory = resolve(managedDirectory(), "previews");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const preview = resolve(directory, `${createHash("sha256").update(`${path}:${file.size}:${file.lastModified}`).digest("hex")}.png`);
  if (await Bun.file(preview).exists()) return preview;
  const temporary = `${preview}.${crypto.randomUUID()}.png`;
  const child = Bun.spawn(["/usr/bin/sips", "-s", "format", "png", "-Z", "88", path, "--out", temporary], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  if (await child.exited !== 0) return path;
  await rename(temporary, preview);
  return preview;
}

let managedWrite: Promise<unknown> = Promise.resolve();

export function setManaged(pack: SavedDockPack, appPaths: readonly string[]): Promise<SavedDockPack> {
  const write = managedWrite.then(async () => {
    const directory = managedDirectory();
    await mkdir(resolve(directory, "artwork"), { recursive: true, mode: 0o700 });
    const icons: SavedDockIcon[] = [];
    for (const path of [...new Set(appPaths)]) {
      const icon = pack.icons.find(item => item.appPath === path);
      if (!icon) throw new Error(`No saved icon for ${path}`);
      if (icon.applyMethod !== "finder") throw new Error(`${icon.name} uses its own icon settings`);
      const bytes = await Bun.file(icon.styledIconPath).arrayBuffer();
      const hash = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
      const artwork = resolve(directory, "artwork", hash);
      await Bun.write(artwork, bytes);
      await chmod(artwork, 0o600);
      icons.push({ ...icon, styledIconPath: artwork, iconPath: artwork });
    }
    const path = resolve(directory, "managed.json");
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await Bun.write(temporary, JSON.stringify({ version: 1, theme: pack.theme, icons }, null, 2));
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    return { path, theme: pack.theme, icons };
  });
  managedWrite = write.catch(() => undefined);
  return write;
}

let reapply: Promise<DockResult[]> | null = null;

export function reapplyManaged(): Promise<DockResult[]> {
  if (reapply) return reapply;
  reapply = (async () => {
    await managedWrite;
    const pack = await getManaged();
    if (!pack || !pack.icons.length) return [];
    return applyDockIcons(pack, pack.icons.map(icon => icon.appPath));
  })().finally(() => { reapply = null; });
  return reapply;
}

export async function resetDockIcons(pack: SavedDockPack, appPaths: readonly string[]): Promise<DockResult[]> {
  if (!appPaths.length) throw new Error("Select at least one application");
  const selected = [...new Set(appPaths)].map(path => {
    const icon = pack.icons.find(item => item.appPath === path);
    if (!icon || icon.applyMethod !== "finder") throw new Error(`${icon?.name ?? path} uses its own icon settings`);
    return { appPath: icon.appPath, iconPath: icon.styledIconPath };
  });
  return array(await helper("buddymac-dock-applier", ["reset"], selected)).map(parseResult);
}

async function command(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const child = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, out, err };
}

export async function refreshDock(): Promise<void> {
  if (process.env.BUDDYMAC_DOCK_NO_REFRESH === "1") return;
  const result = await command(["/usr/bin/killall", "Dock"]);
  if (result.code !== 0) throw new Error("The Dock could not be refreshed.");
}

export async function relaunchApp(icon: DockApp): Promise<void> {
  const running = async () => (await command(["/usr/bin/pgrep", "-f", `${icon.appPath}/Contents/MacOS/`])).code === 0;
  if (await running()) {
    const target = icon.bundleIdentifier ? ["tell application id (item 1 of argv) to quit"] : ["tell application (POSIX file (item 1 of argv) as alias as text) to quit"];
    const quit = await command(["/usr/bin/osascript", "-e", "on run argv", "-e", target[0]!, "-e", "end run", icon.bundleIdentifier ?? icon.appPath]);
    if (quit.code !== 0) throw new Error(`${icon.name} did not quit. Close it yourself, then open it again.`);
    for (let attempt = 0; attempt < 100 && await running(); attempt++) await Bun.sleep(200);
    if (await running()) throw new Error(`${icon.name} is still open. It may be waiting for you to save something.`);
  }
  const open = await command(["/usr/bin/open", icon.appPath]);
  if (open.code !== 0) throw new Error(`${icon.name} could not be opened.`);
}

const settingsPath = () => resolve(managedDirectory(), "settings.json");
export async function currentPackPath(): Promise<string | undefined> {
  const file = Bun.file(settingsPath());
  if (!await file.exists()) return undefined;
  const value: unknown = await file.json();
  return typeof value === "object" && value !== null && "packPath" in value && typeof value.packPath === "string" ? value.packPath : undefined;
}
export async function setCurrentPack(path: string): Promise<void> {
  await mkdir(managedDirectory(), { recursive: true, mode: 0o700 });
  const temporary = `${settingsPath()}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporary, JSON.stringify({ packPath: path }));
  await chmod(temporary, 0o600);
  await rename(temporary, settingsPath());
}
export async function loadCurrentPack(): Promise<SavedDockPack | null> {
  const path = await currentPackPath();
  if (path && await Bun.file(path).exists()) return loadSavedDockPack(path);
  return loadSavedDockPack();
}

const iconSizes = [16, 32, 128, 256, 512];
export async function createDockPack(theme: string, entries: { app: DockApp; imagePath: string }[]): Promise<SavedDockPack> {
  const name = theme.trim();
  if (!name) throw new Error("Name the icon pack.");
  if (!entries.length) throw new Error("Choose artwork for at least one app.");
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pack"}-${new Date().toISOString().slice(0, 10)}`;
  const root = resolve(managedDirectory(), "packs", slug);
  if (await Bun.file(resolve(root, "manifest.json")).exists()) throw new Error("A pack with this name already exists today. Choose another name.");
  const staging = `${root}.${crypto.randomUUID()}.tmp`;
  await mkdir(resolve(staging, "png"), { recursive: true, mode: 0o700 });
  await mkdir(resolve(staging, "icns"), { recursive: true, mode: 0o700 });
  const icons: SavedDockIcon[] = [];
  try {
    for (const [index, { app, imagePath }] of entries.entries()) {
      const base = `${String(index + 1).padStart(2, "0")}-${app.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const png = resolve(staging, "png", `${base}.png`);
      const converted = await command(["/usr/bin/sips", "-s", "format", "png", "-z", "1024", "1024", imagePath, "--out", png]);
      if (converted.code !== 0) throw new Error(`${app.name}: the image could not be read.`);
      const iconset = resolve(staging, `${base}.iconset`);
      await mkdir(iconset, { recursive: true });
      for (const size of iconSizes) {
        for (const scale of [1, 2]) {
          const pixels = size * scale;
          const out = resolve(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`);
          if ((await command(["/usr/bin/sips", "-z", String(pixels), String(pixels), png, "--out", out])).code !== 0) throw new Error(`${app.name}: the icon sizes could not be created.`);
        }
      }
      const icns = resolve(staging, "icns", `${base}.icns`);
      if ((await command(["/usr/bin/iconutil", "-c", "icns", iconset, "-o", icns])).code !== 0) throw new Error(`${app.name}: the icon file could not be created.`);
      await Bun.spawn(["/bin/rm", "-rf", iconset]).exited;
      const ghostty = app.bundleIdentifier === "com.mitchellh.ghostty";
      icons.push({ ...app, iconPath: app.iconPath, styledIconPath: resolve(root, ghostty ? "png" : "icns", ghostty ? `${base}.png` : `${base}.icns`), applyMethod: ghostty ? "external" : "finder" });
    }
    await Bun.write(resolve(staging, "manifest.json"), JSON.stringify({ version: 1, theme: name, icons }, null, 2));
    await mkdir(dirname(root), { recursive: true, mode: 0o700 });
    await rename(staging, root);
  } catch (error) {
    await Bun.spawn(["/bin/rm", "-rf", staging]).exited;
    throw error;
  }
  const path = resolve(root, "manifest.json");
  await setCurrentPack(path);
  const pack = await loadSavedDockPack(path);
  if (!pack) throw new Error("The new pack could not be read.");
  return pack;
}
