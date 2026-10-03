import { dlopen, FFIType } from "bun:ffi";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { chmod, mkdir, rename } from "node:fs/promises";

export interface EdgeSettings {
  side: "off" | "left" | "right";
  pinned: boolean;
  autoShow: boolean;
  holdDelay: number;
  onlyFiles: boolean;
}
export const defaultEdgeSettings: EdgeSettings = { side: "off", pinned: false, autoShow: true, holdDelay: 0.8, onlyFiles: true };

const packaged = process.execPath.includes(".app/Contents/MacOS/");
const root = process.env.BUDDYMAC_NATIVE_DIR ?? (packaged ? dirname(process.execPath) : resolve(import.meta.dir, "../dist/native"));
const library = dlopen(resolve(root, "libbuddymac-edge.dylib"), {
  buddymac_edge_configure: { args: [FFIType.int, FFIType.bool, FFIType.bool, FFIType.double, FFIType.bool], returns: FFIType.void },
  buddymac_edge_files_active: { args: [FFIType.bool], returns: FFIType.void },
  buddymac_edge_show: { args: [], returns: FFIType.void },
  buddymac_edge_state: { args: [], returns: FFIType.cstring },
  buddymac_edge_presented: { args: [], returns: FFIType.void },
  buddymac_edge_side: { args: [], returns: FFIType.int },
});

function parseSettings(value: unknown): EdgeSettings {
  if (typeof value !== "object" || value === null || !("side" in value) || !("pinned" in value) ||
    !("autoShow" in value) || !("holdDelay" in value) ||
    (value.side !== "off" && value.side !== "left" && value.side !== "right") ||
    typeof value.pinned !== "boolean" || typeof value.autoShow !== "boolean" ||
    typeof value.holdDelay !== "number" || !Number.isFinite(value.holdDelay) || value.holdDelay < 0.2 || value.holdDelay > 3) {
    throw new Error("Invalid Files edge settings");
  }
  const onlyFiles = "onlyFiles" in value ? value.onlyFiles : true;
  if (typeof onlyFiles !== "boolean") throw new Error("Invalid Files edge settings");
  return { side: value.side, pinned: value.pinned, autoShow: value.autoShow, holdDelay: value.holdDelay, onlyFiles };
}

const settingsPath = () => resolve(process.env.BUDDYMAC_DATA_DIR ?? resolve(homedir(), "Library/Application Support/BuddyMac"), "Files/edge.json");

export async function loadEdgeSettings(): Promise<EdgeSettings> {
  const file = Bun.file(settingsPath());
  return await file.exists() ? parseSettings(await file.json()) : { ...defaultEdgeSettings };
}

export function configureEdge(settings: EdgeSettings): void {
  const value = parseSettings(settings);
  library.symbols.buddymac_edge_configure(value.side === "left" ? 1 : value.side === "right" ? 2 : 0, value.pinned, value.autoShow, value.holdDelay, value.onlyFiles);
}

let saving: Promise<unknown> = Promise.resolve();
export function saveEdgeSettings(settings: EdgeSettings): Promise<void> {
  const value = parseSettings(settings);
  const saved = saving.then(async () => {
    const path = settingsPath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await Bun.write(temporary, JSON.stringify(value));
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    configureEdge(value);
  });
  saving = saved.catch(() => undefined);
  return saved;
}

export const setEdgeFilesActive = (active: boolean) => library.symbols.buddymac_edge_files_active(active);
export const showEdgeShelf = () => library.symbols.buddymac_edge_show();
export const edgePresented = () => library.symbols.buddymac_edge_presented();
export const getFilesEdge = (): 'left' | 'right' => library.symbols.buddymac_edge_side() === 1 ? 'left' : 'right';
export function getEdgeState(): { active: boolean; revealed: boolean; requested: boolean } {
  const value: unknown = JSON.parse(String(library.symbols.buddymac_edge_state()));
  if (typeof value !== "object" || value === null || !("active" in value) || typeof value.active !== "boolean" ||
    !("revealed" in value) || typeof value.revealed !== "boolean") throw new Error("Invalid edge state");
  return { active: value.active, revealed: value.revealed, requested: 'requested' in value && value.requested === true };
}
