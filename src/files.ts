import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export interface ShelfFile {
  path: string;
  name: string;
  exists: boolean;
  size?: number;
  kind?: string;
  modifiedAt?: string;
}

function parseFiles(value: unknown): ShelfFile[] {
  if (!Array.isArray(value)) throw new Error("Invalid Files helper response");
  return value.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || !("path" in entry) || typeof entry.path !== "string" ||
      !("name" in entry) || typeof entry.name !== "string" || !("exists" in entry) || typeof entry.exists !== "boolean") {
      throw new Error("Invalid file in Files helper response");
    }
    return {
      path: entry.path, name: entry.name, exists: entry.exists,
      size: "size" in entry && typeof entry.size === "number" ? entry.size : undefined,
      kind: "kind" in entry && typeof entry.kind === "string" ? entry.kind : undefined,
      modifiedAt: "modifiedAt" in entry && typeof entry.modifiedAt === "string" ? entry.modifiedAt : undefined,
    };
  });
}

async function runFiles(action: string, paths: readonly string[] = []): Promise<ShelfFile[]> {
  const directory = process.env.BUDDYMAC_NATIVE_DIR ?? (process.execPath.includes(".app/Contents/MacOS/")
    ? dirname(process.execPath) : resolve(dirname(import.meta.path), "../dist/native"));
  const helper = resolve(directory, "buddymac-files");
  const child = Bun.spawn([helper], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: process.env });
  child.stdin.write(JSON.stringify({ action, paths }));
  child.stdin.end();
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(err.trim() || `Files helper exited with ${code}`);
  return parseFiles(JSON.parse(out));
}

export const listFiles = () => runFiles("list");
export const addFiles = (paths: readonly string[]) => runFiles("add", paths);
export const removeFiles = (paths: readonly string[]) => runFiles("remove", paths);
export const clearFiles = () => runFiles("clear");
export const importLegacyFiles = () => runFiles("import");
export const copyFiles = (paths: readonly string[]) => runFiles("copy", paths);
export const pasteFiles = () => runFiles("paste");
export const revealFiles = (paths: readonly string[]) => runFiles("reveal", paths);
export const openFiles = (paths: readonly string[]) => runFiles("open", paths);
export const chooseFiles = () => runFiles("choose");

const manifestPath = () => resolve(process.env.BUDDYMAC_DATA_DIR ?? resolve(homedir(), "Library/Application Support/BuddyMac"), "Files/manifest.json");

/**
 * Changes when the shelf manifest changes or a shelved file appears or disappears. Polling this costs one small
 * read and a stat per file; `listFiles` launches the helper and asks Launch Services for every file's kind.
 */
export async function shelfSignature(): Promise<string> {
  const manifest = await Bun.file(manifestPath()).text().catch(() => "");
  let paths: unknown = [];
  try { paths = JSON.parse(manifest); } catch {}
  const present = Array.isArray(paths) ? await Promise.all(paths.map(path => typeof path === "string"
    ? stat(path).then(info => info.isFile() ? "1" : "0", () => "0") : "0")) : [];
  return `${manifest}\n${present.join("")}`;
}
