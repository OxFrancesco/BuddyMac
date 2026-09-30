import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { applyDockIcons, dockStatus, getManaged, loadSavedDockPack, reapplyManaged, setManaged } from "../../src/dock";

const directory = await mkdtemp("/private/tmp/buddymac-dock-test-");
afterAll(async () => { await rm(directory, { recursive: true }); });

test("applies saved artwork to a fixture app and preserves app resources", async () => {
  process.env.BUDDYMAC_DATA_DIR = join(directory, "data");
  const app = join(directory, "Fixture.app");
  await mkdir(join(app, "Contents/Resources"), { recursive: true });
  await Bun.write(join(app, "Contents/Info.plist"), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.buddytools.buddymac.fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
  const sentinel = join(app, "Contents/Resources/sentinel");
  await Bun.write(sentinel, "preserve");
  const icon = process.env.BUDDYMAC_TEST_ICON ?? "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns";
  const path = join(directory, "manifest.json");
  const raw = JSON.stringify({ version: 1, theme: "fixture", icons: [{
    id: "fixture", name: "Fixture", appPath: app, bundleIdentifier: null, iconPath: icon, styledIconPath: icon,
  }] });
  await Bun.write(path, raw);
  const pack = await loadSavedDockPack(path);
  if (!pack) throw new Error("Fixture pack missing");
  expect((await dockStatus(pack))[0]?.applied).toBe(false);
  await expect(applyDockIcons(pack, [])).rejects.toThrow("Select");
  await expect(applyDockIcons(pack, ["unknown.app"])).rejects.toThrow("No saved icon");
  const applied = await applyDockIcons(pack, [app]);
  expect(applied[0]?.error).toBeNull();
  expect(applied[0]?.applied).toBe(true);
  expect(applied[0]?.changed).toBe(true);
  expect((await dockStatus(pack))[0]?.applied).toBe(true);
  expect((await applyDockIcons(pack, [app]))[0]?.changed).toBe(false);
  expect(await Bun.file(sentinel).text()).toBe("preserve");
  expect(await Bun.file(path).text()).toBe(raw);
  const managed = await setManaged(pack, [app]);
  expect(managed.icons[0]?.styledIconPath.startsWith(join(directory, "data"))).toBe(true);
  expect((await getManaged())?.icons).toHaveLength(1);
  expect((await reapplyManaged())[0]?.applied).toBe(true);
  const other = { ...pack, icons: pack.icons.map(icon => ({ ...icon, styledIconPath: "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericFolderIcon.icns" })) };
  expect((await applyDockIcons(other, [app]))[0]?.applied).toBe(true);
  expect((await dockStatus(managed))[0]?.applied).toBe(false);
  expect((await reapplyManaged())[0]?.changed).toBe(true);
  expect((await dockStatus(managed))[0]?.applied).toBe(true);
  await setManaged(pack, []);
  expect(await reapplyManaged()).toEqual([]);
  expect(await Bun.file(path).text()).toBe(raw);
}, 30000);

async function nativeDock(action: string, input: string) {
  const child = Bun.spawn([join(import.meta.dir, '../../dist/native/buddymac-dock-applier'), action], {
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: process.env,
  });
  child.stdin.write(input); child.stdin.end();
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { out, error, code };
}

async function fixture(name: string) {
  const appPath = join(directory, `${name}.app`);
  await mkdir(join(appPath, 'Contents/Resources'), { recursive: true });
  await Bun.write(join(appPath, 'Contents/Info.plist'), '<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.buddytools.test</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
  const styledIconPath = '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns';
  return { path: join(directory, `${name}.json`), theme: name, icons: [{ id: name, name, appPath, iconPath: styledIconPath, styledIconPath, bundleIdentifier: null, applyMethod: 'finder' as const }] };
}

test('pack parsing rejects bad schemas and resolves relative paths; external methods cannot be applied', async () => {
  expect(await loadSavedDockPack(join(directory, 'absent.json'))).toBeNull();
  const path = join(directory, 'parse.json');
  for (const value of [[], { version: 2 }, { version: 1, theme: 1, icons: [] }, { version: 1, theme: 'x', icons: [{}] }]) {
    await Bun.write(path, JSON.stringify(value));
    await expect(loadSavedDockPack(path)).rejects.toThrow();
  }
  const pack = await fixture('Relative');
  await Bun.write(path, JSON.stringify({ version: 1, theme: 'relative', icons: [{ ...pack.icons[0], appPath: 'Relative.app', iconPath: 'source.icns', styledIconPath: 'styled.icns' }] }));
  const parsed = await loadSavedDockPack(path);
  expect(parsed?.icons[0]?.appPath).toBe(join(directory, 'Relative.app'));
  expect(parsed?.icons[0]?.styledIconPath).toBe(join(directory, 'styled.icns'));
  for (const method of ['ghostty', 'external'] as const) {
    const external = { ...pack, icons: pack.icons.map(icon => ({ ...icon, applyMethod: method })) };
    expect((await dockStatus(external))[0]?.error).toContain('own settings');
    await expect(applyDockIcons(external, [pack.icons[0]!.appPath])).rejects.toThrow('own icon settings');
    await expect(setManaged(external, [pack.icons[0]!.appPath])).rejects.toThrow('own icon settings');
  }
  await Bun.write(path, JSON.stringify({ version: 1, theme: 'x', icons: [{ ...pack.icons[0], applyMethod: 'unsupported' }] }));
  await expect(loadSavedDockPack(path)).rejects.toThrow('Unsupported');
});

test('fixture apply deduplicates, reports no-op success, rejects invalid targets, and supports reset', async () => {
  const { chmod } = await import('node:fs/promises');
  const pack = await fixture('Safety');
  const app = pack.icons[0]!.appPath;
  const applied = await applyDockIcons(pack, [app, app]);
  expect(applied).toHaveLength(1);
  expect(applied[0]?.changed).toBe(true);
  const noop = (await applyDockIcons(pack, [app]))[0];
  expect(noop?.applied).toBe(true);
  expect(noop?.changed).toBe(false);
  expect(noop?.error).toBeNull();
  const invalidIcon = { ...pack, icons: pack.icons.map(icon => ({ ...icon, styledIconPath: join(directory, 'invalid.icns') })) };
  await Bun.write(join(directory, 'invalid.icns'), 'not image bytes');
  expect((await applyDockIcons(invalidIcon, [app]))[0]?.error).toContain('Could not load icon');
  expect((await dockStatus(pack))[0]?.applied).toBe(true);
  for (const target of [join(directory, 'missing.app'), directory]) {
    const result = await nativeDock('apply', JSON.stringify([{ appPath: target, iconPath: pack.icons[0]!.styledIconPath }]));
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)[0].applied).toBe(false);
    expect(JSON.parse(result.out)[0].changed).toBe(false);
  }
  await chmod(app, 0o500);
  try {
    const denied = await nativeDock('reset', JSON.stringify([{ appPath: app }]));
    expect(JSON.parse(denied.out)[0].error).toContain('write denied');
    expect((await dockStatus(pack))[0]?.applied).toBe(true);
  } finally { await chmod(app, 0o700); }
  const reset = await nativeDock('reset', JSON.stringify([{ appPath: app }]));
  expect(JSON.parse(reset.out)[0].applied).toBe(true);
  expect((await dockStatus(pack))[0]?.applied).toBe(false);
  for (const [action, input] of [['invalid', '[]'], ['apply', 'invalid-json'], ['apply', '[{}]']]) {
    const result = await nativeDock(action!, input!);
    expect(result.code).toBe(1);
    expect(result.error.length).toBeGreaterThan(0);
  }
});

test('managed artwork survives source deletion, failed selections preserve settings, writes serialize and reapply overlaps coalesce', async () => {
  const { stat } = await import('node:fs/promises');
  const pack = await fixture('Managed');
  const source = join(directory, 'managed-source.icns');
  await Bun.write(source, Bun.file(pack.icons[0]!.styledIconPath));
  pack.icons[0]!.styledIconPath = source;
  const app = pack.icons[0]!.appPath;
  const managed = await setManaged(pack, [app, app]);
  expect(managed.icons).toHaveLength(1);
  expect((await stat(managed.path)).mode & 0o777).toBe(0o600);
  expect((await stat(managed.icons[0]!.styledIconPath)).mode & 0o777).toBe(0o600);
  await rm(source);
  await expect(setManaged(pack, [app])).rejects.toThrow();
  expect((await getManaged())?.icons).toEqual(managed.icons);
  await expect(setManaged(pack, ['unknown'])).rejects.toThrow();
  const first = reapplyManaged(), second = reapplyManaged();
  expect(first).toBe(second);
  expect((await first)[0]?.applied).toBe(true);
  const alternate = await fixture('ManagedAlternate');
  await Promise.all([setManaged(alternate, [alternate.icons[0]!.appPath]), setManaged(alternate, [])]);
  expect((await getManaged())?.icons).toEqual([]);
  expect(await reapplyManaged()).toEqual([]);
});

test('pinned app inspection exports real icons only to the isolated data directory', async () => {
  const { listDockApps } = await import('../../src/dock');
  const apps = await listDockApps();
  expect(Array.isArray(apps)).toBe(true);
  for (const app of apps) {
    expect(app.name.length).toBeGreaterThan(0);
    expect(app.appPath.startsWith('/')).toBe(true);
    expect(app.iconPath.startsWith(join(directory, 'data/Dock/icons'))).toBe(true);
    expect((await Bun.file(app.iconPath).arrayBuffer()).byteLength).toBeGreaterThan(0);
  }
});
