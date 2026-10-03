import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { addFiles, clearFiles, copyFiles, importLegacyFiles, listFiles, pasteFiles, removeFiles } from "../../src/files";

const directory = await mkdtemp("/private/tmp/buddymac-files-test-");
const legacy = join(directory, "legacy");
await mkdir(legacy);
process.env.BUDDYMAC_DATA_DIR = join(directory, "data");
process.env.BUDDYMAC_LEGACY_FILES_DIR = legacy;
process.env.BUDDYMAC_PASTEBOARD_NAME = `BuddyMac.Files.Test.${crypto.randomUUID()}`;
afterAll(async () => { await rm(directory, { recursive: true }); });

test("starts empty, imports only on request, and serializes concurrent writers", async () => {
  const first = join(directory, "A file ' $ with spaces.txt");
  await Bun.write(first, "original contents");
  const manifest = JSON.stringify([first]);
  await Bun.write(join(legacy, "manifest.json"), manifest);
  await Bun.write(join(legacy, "manifest.lock"), "");
  expect(await listFiles()).toEqual([]);
  const imported = await importLegacyFiles();
  const stored = imported[0]?.path;
  if (!stored) throw new Error("Imported file missing");
  expect(await Bun.file(stored).text()).toBe("original contents");
  expect((await listFiles())[0]?.size).toBe(17);
  const alias = join(directory, "alias");
  await symlink(first, alias);
  expect(await addFiles([alias, first])).toHaveLength(1);
  const second = join(directory, "second.txt");
  await Bun.write(second, "second");
  await expect(addFiles([second, join(directory, "missing")])).rejects.toThrow();
  expect(await listFiles()).toHaveLength(1);
  const concurrent = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    const path = join(directory, `${index}.txt`);
    await Bun.write(path, `${index}`);
    return path;
  }));
  await Promise.all(concurrent.map(path => addFiles([path])));
  expect(await listFiles()).toHaveLength(21);
  await copyFiles([first]);
  await clearFiles();
  expect((await pasteFiles()).map(file => file.path)).toEqual([stored]);
  await removeFiles([stored]);
  expect(await listFiles()).toHaveLength(0);
  expect(await Bun.file(first).text()).toBe("original contents");
  expect(await Bun.file(join(legacy, "manifest.json")).text()).toBe(manifest);
  expect((await importLegacyFiles()).map(file => file.path)).toEqual([stored]);
  await rm(first);
  expect((await listFiles())[0]?.exists).toBe(false);
}, 30000);

async function requestRaw(input: string, extraEnv: Record<string, string> = {}) {
  const child = Bun.spawn([join(import.meta.dir, '../../dist/native/buddymac-files')], {
    env: { ...process.env, ...extraEnv }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  });
  child.stdin.write(input); child.stdin.end();
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { out, error, code };
}

test('rejects invalid file and protocol input without changing the shelf or clipboard', async () => {
  await clearFiles();
  const path = join(directory, 'validation.txt');
  await Bun.write(path, 'validation');
  const canonical = (await addFiles([path]))[0]!.path;
  await copyFiles([path]);
  const invalid = [[], [directory], [join(directory, 'missing-again')]];
  for (const paths of invalid) {
    await expect(addFiles(paths)).rejects.toThrow();
    await expect(copyFiles(paths)).rejects.toThrow();
    expect((await listFiles()).map(file => file.path)).toEqual([canonical]);
  }
  await clearFiles();
  expect((await pasteFiles()).map(file => file.path)).toEqual([canonical]);
  for (const raw of ['not-json', '{"action":"unknown"}', '{"action":"add","paths":[1]}']) {
    const result = await requestRaw(raw);
    expect(result.code).toBe(1);
    expect(result.error.length).toBeGreaterThan(0);
  }
  for (const action of ['open', 'reveal']) {
    const result = await requestRaw(JSON.stringify({ action, paths: [join(directory, 'no-file')] }));
    expect(result.code).toBe(1);
  }
  expect((await requestRaw('{"action":"open","paths":[]}')).code).toBe(1);
  expect((await requestRaw('{"action":"open","paths":["a","b"]}')).code).toBe(1);
  const empty = await requestRaw('{"action":"paste"}', { BUDDYMAC_PASTEBOARD_NAME: `BuddyMac.Empty.${crypto.randomUUID()}` });
  expect(empty.code).toBe(1);
  expect(empty.error).toContain('no files');
  expect((await listFiles()).map(file => file.path)).toEqual([canonical]);
});

test('merge import deduplicates and preserves missing entries; repeat remove and clear are safe', async () => {
  const existing = (await listFiles())[0]!.path;
  const another = join(directory, 'imported.txt');
  const missing = join(directory, 'legacy-missing.txt');
  await Bun.write(another, 'imported');
  const bytes = JSON.stringify([another, existing, another, missing]);
  await Bun.write(join(legacy, 'manifest.json'), bytes);
  expect((await listFiles()).map(file => file.path)).toEqual([existing]);
  const merged = await importLegacyFiles();
  const canonicalAnother = merged[1]!.path;
  expect(merged.map(file => file.name)).toEqual(['validation.txt', 'imported.txt', 'legacy-missing.txt']);
  expect(await Bun.file(canonicalAnother).text()).toBe('imported');
  expect(merged[2]?.exists).toBe(false);
  expect(await importLegacyFiles()).toEqual(merged);
  expect(await Bun.file(join(legacy, 'manifest.json')).text()).toBe(bytes);
  await removeFiles([existing, canonicalAnother, 'not-in-shelf']);
  expect((await removeFiles([existing])).map(file => file.path)).toEqual([missing]);
  expect(await removeFiles([missing])).toEqual([]);
  expect(await clearFiles()).toEqual([]);
  expect(await Bun.file(existing).text()).toBe('validation');
  expect(await Bun.file(another).text()).toBe('imported');
});

test('corrupt own or legacy storage fails without destroying the manifest; own state is private', async () => {
  const { stat } = await import('node:fs/promises');
  const own = join(directory, 'data/Files/manifest.json');
  expect((await stat(own)).mode & 0o777).toBe(0o600);
  expect((await stat(join(directory, 'data/Files'))).mode & 0o777).toBe(0o700);
  await Bun.write(own, '{broken');
  await expect(listFiles()).rejects.toThrow();
  await expect(clearFiles()).rejects.toThrow();
  expect(await Bun.file(own).text()).toBe('{broken');
  await Bun.write(own, '[]');
  await Bun.write(join(legacy, 'manifest.json'), '{broken legacy');
  await expect(importLegacyFiles()).rejects.toThrow();
  expect(await listFiles()).toEqual([]);
  expect(await Bun.file(join(legacy, 'manifest.json')).text()).toBe('{broken legacy');
  const result = await requestRaw('{"action":"list"}', { BUDDYMAC_DATA_DIR: join(directory, 'fresh') });
  expect(result.code).toBe(0);
  expect(await Bun.file(join(directory, 'fresh/Files/manifest.json')).json()).toEqual([]);
});

test('edge preferences default off, persist all controls, reject invalid data, and stay inactive without a window', async () => {
  const { defaultEdgeSettings, loadEdgeSettings, saveEdgeSettings, getEdgeState } = await import('../../src/edge');
  const path = join(directory, 'data/Files/edge.json');
  expect(await loadEdgeSettings()).toEqual(defaultEdgeSettings);
  for (const settings of [
    { side: 'left' as const, pinned: true, autoShow: false, holdDelay: 0.2, onlyFiles: true },
    { side: 'right' as const, pinned: false, autoShow: true, holdDelay: 3, onlyFiles: false },
    { ...defaultEdgeSettings },
  ]) {
    await saveEdgeSettings(settings);
    expect(await loadEdgeSettings()).toEqual(settings);
    expect(getEdgeState()).toEqual({ active: false, revealed: false, requested: false });
  }
  for (const holdDelay of [0.1, 3.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => saveEdgeSettings({ ...defaultEdgeSettings, holdDelay })).toThrow('Invalid Files edge settings');
    expect(await loadEdgeSettings()).toEqual(defaultEdgeSettings);
  }
  await Bun.write(path, JSON.stringify({ side: 'left', pinned: false, autoShow: true, holdDelay: 1 }));
  expect(await loadEdgeSettings()).toEqual({ side: 'left', pinned: false, autoShow: true, holdDelay: 1, onlyFiles: true });
  for (const invalid of [{ ...defaultEdgeSettings, side: 'top' }, { ...defaultEdgeSettings, pinned: 'yes' }, { ...defaultEdgeSettings, onlyFiles: 'no' }, {}]) {
    await Bun.write(path, JSON.stringify(invalid));
    await expect(loadEdgeSettings()).rejects.toThrow('Invalid Files edge settings');
  }
});
