import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { useEffect, useSyncExternalStore } from "react";

export type CameraKind = "usb" | "continuity" | "builtIn" | "deskView" | "other";
export type Authorization = "authorized" | "denied" | "restricted" | "notDetermined";
export interface CameraDevice { id: string; name: string; kind: CameraKind; model: string; manufacturer: string }
export interface CameraMode { id: string; width: number; height: number; fps: number; compressed: boolean }
export interface CameraState {
  authorization: Authorization;
  microphoneAuthorization: Authorization;
  devices: CameraDevice[];
  microphones: { id: string; name: string }[];
  device: string | null;
  modes: CameraMode[];
  mode: string | null;
  mirror: boolean;
  microphone: string | null;
  codec: "hevc" | "h264";
  folder: string;
  preview: boolean;
  running: boolean;
  recording: { path: string; startedAt: number } | null;
  lastRecording: string | null;
  error: string;
  version: number;
}
export interface Recording { path: string; name: string; size: number; modifiedAt: number }
export type CameraEvent = { event: "state"; state: CameraState } | { event: "recorded"; path: string; ok: boolean; error?: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid camera helper response.");
  return value as Record<string, unknown>;
}
const string = (value: unknown) => { if (typeof value !== "string") throw new Error("Invalid camera helper text."); return value; };
const number = (value: unknown) => { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid camera helper number."); return value; };
const boolean = (value: unknown) => { if (typeof value !== "boolean") throw new Error("Invalid camera helper flag."); return value; };
const nullable = <T>(value: unknown, parse: (value: unknown) => T) => value === null || value === undefined ? null : parse(value);
const list = <T>(value: unknown, parse: (value: unknown) => T) => { if (!Array.isArray(value)) throw new Error("Invalid camera helper list."); return value.map(parse); };
const authorization = (value: unknown): Authorization => value === "authorized" || value === "denied" || value === "restricted" ? value : "notDetermined";
const kinds: CameraKind[] = ["usb", "continuity", "builtIn", "deskView"];
const kind = (value: unknown): CameraKind => kinds.find(item => item === value) ?? "other";

export function parseState(value: unknown): CameraState {
  const item = record(value);
  return {
    authorization: authorization(item.authorization), microphoneAuthorization: authorization(item.microphoneAuthorization),
    devices: list(item.devices, value => { const device = record(value); return { id: string(device.id), name: string(device.name), kind: kind(device.kind), model: string(device.model), manufacturer: string(device.manufacturer) }; }),
    microphones: list(item.microphones, value => { const microphone = record(value); return { id: string(microphone.id), name: string(microphone.name) }; }),
    device: nullable(item.device, string),
    modes: list(item.modes, value => { const mode = record(value); return { id: string(mode.id), width: number(mode.width), height: number(mode.height), fps: number(mode.fps), compressed: boolean(mode.compressed) }; }),
    mode: nullable(item.mode, string), mirror: boolean(item.mirror), microphone: nullable(item.microphone, string),
    codec: item.codec === "h264" ? "h264" : "hevc", folder: string(item.folder), preview: boolean(item.preview), running: boolean(item.running),
    recording: nullable(item.recording, value => { const active = record(value); return { path: string(active.path), startedAt: number(active.startedAt) }; }),
    lastRecording: nullable(item.lastRecording, string), error: string(item.error), version: number(item.version),
  };
}
function parseRecording(value: unknown): Recording {
  const item = record(value);
  return { path: string(item.path), name: string(item.name), size: number(item.size), modifiedAt: number(item.modifiedAt) };
}

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void }

/** The camera helper process. Frames stay inside it: BuddyMac only sends settings and gets state back. */
export class CameraClient {
  private readonly process: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private closed = false;

  constructor(private readonly onEvent: (event: CameraEvent) => void, binaryPath?: string) {
    const path = binaryPath ?? process.env.BUDDYMAC_CAMERA_BINARY ?? [
      join(process.env.BUDDYMAC_NATIVE_DIR ?? dirname(process.execPath), "buddymac-camera"),
      resolve(import.meta.dir, "../dist/native/buddymac-camera"),
      join(process.cwd(), "dist/native/buddymac-camera"),
    ].find(existsSync);
    if (!path) throw new Error("Build BuddyMac's camera helper with scripts/build-camera.sh.");
    this.process = Bun.spawn([path], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env } });
    void this.read();
    void this.process.stderr.pipeTo(new WritableStream({ write() {} })).catch(() => {});
    void this.process.exited.then(code => { if (!this.closed) this.fail(new Error(`Camera helper exited with status ${code}.`)); this.closed = true; });
  }

  async state() { return parseState(await this.request("state")); }
  async configure(changes: Partial<Pick<CameraState, "device" | "mode" | "mirror" | "microphone" | "codec" | "folder">>) { return parseState(await this.request("configure", changes)); }
  async preview(enabled: boolean) { return parseState(await this.request("preview", { enabled })); }
  async record(enabled: boolean) { return parseState(await this.request("record", { enabled })); }
  async recordings() { return list(await this.request("recordings"), parseRecording); }
  async trash(path: string) { return list(await this.request("trash", { path }), parseRecording); }
  async chooseFolder() { return parseState(await this.request("chooseFolder")); }
  /** The preview window's number for `screencapture -l`, or 0 while it is hidden. */
  async previewWindow() { return number(record(await this.request("previewWindow")).windowNumber); }

  /** Closing stdin lets the helper finish an open recording before it exits. */
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.process.stdin.end();
    this.fail(new Error("Camera helper closed."));
    const child = this.process, timeout = setTimeout(() => child.kill(), 8000);
    void child.exited.finally(() => clearTimeout(timeout));
  }

  private request(method: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("The camera helper is not running."));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.process.stdin.write(JSON.stringify({ ...fields, id, method }) + "\n"); this.process.stdin.flush(); }
      catch (error) { this.pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  private async read() {
    const reader = this.process.stdout.getReader(), decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line) this.receive(JSON.parse(line));
        }
      }
    } catch { this.fail(new Error("The camera helper connection failed.")); }
  }

  private receive(value: unknown) {
    const item = record(value);
    if (typeof item.id === "number") {
      const request = this.pending.get(item.id);
      if (!request) return;
      this.pending.delete(item.id);
      if (item.ok === true) request.resolve(item.result); else request.reject(new Error(string(item.error)));
    } else if (item.event === "state") this.onEvent({ event: "state", state: parseState(item) });
    else if (item.event === "recorded") this.onEvent({ event: "recorded", path: string(item.path), ok: boolean(item.ok), ...typeof item.error === "string" ? { error: item.error } : {} });
  }

  private fail(error: Error) {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}

// The helper starts when the Camera section opens or a camera command runs, and quits once nothing shows it:
// no view, no preview window and no recording. Idle, BuddyMac keeps no camera process around.
let client: CameraClient | null = null;
let state: CameraState | null = null;
let error = "";
let views = 0, busy = 0;
const listeners = new Set<() => void>();
const recordedListeners = new Set<(event: Extract<CameraEvent, { event: "recorded" }>) => void>();
let snapshot: { state: CameraState | null; error: string } = { state, error };
function notify() { snapshot = { state, error }; for (const listener of listeners) listener(); }
function accept(next: CameraState) { if (state && next.version < state.version) return; state = next; notify(); releaseIfIdle(); }
function releaseIfIdle() {
  if (views > 0 || busy > 0 || !client || state?.preview || state?.recording) return;
  client.dispose(); client = null; state = null; notify();
}

export function camera(): CameraClient {
  if (client) return client;
  const next = new CameraClient(event => {
    if (event.event === "state") accept(event.state);
    else for (const listener of recordedListeners) listener(event);
  });
  client = next;
  void next.state().then(accept, report);
  return next;
}
function report(cause: unknown) { error = cause instanceof Error ? cause.message : String(cause); notify(); }

/** Runs a camera command and keeps the state it returns. Errors land in `useCamera().error`. */
export async function cameraAction(work: (client: CameraClient) => Promise<CameraState | unknown>) {
  error = ""; notify(); busy++;
  try { const result = await work(camera()); busy--; if (result && typeof result === "object" && "authorization" in result) accept(result as CameraState); else releaseIfIdle(); }
  catch (cause) { busy--; report(cause); releaseIfIdle(); }
}
export const toggleCameraPreview = () => cameraAction(client => client.preview(!state?.preview));
export const toggleCameraRecording = () => cameraAction(client => client.record(!state?.recording));
export function onCameraRecorded(listener: (event: Extract<CameraEvent, { event: "recorded" }>) => void) { recordedListeners.add(listener); return () => { recordedListeners.delete(listener); }; }
export function closeCamera() { client?.dispose(); client = null; state = null; }

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useCamera() {
  useEffect(() => {
    views++;
    try { camera(); } catch (cause) { report(cause); }
    return () => { views--; releaseIfIdle(); };
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot);
}
