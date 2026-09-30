import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type SpeechPhase = "idle" | "requestingPermission" | "recording" | "transcribing" | "formatting" | "inserting" | "success" | "failed";
export type DictationStyle = "natural" | "casual" | "professional" | "verbatim";
export interface SpeechShortcut { keyCode: number; modifiers: number; keyLabel: string }
export interface WriteHotkey { keyCode: number; modifiersRawValue: number }
export interface VocabularyEntry { id: string; spoken: string; replacement: string }
export interface SpeechSnippet { id: string; trigger: string; expansion: string }
export interface AppStyleRule { id: string; bundleID: string; name: string; style: DictationStyle }
export interface SpeechPreferences {
  screenContextEnabled: boolean; memoryEnabled: boolean; language: string;
  cleanupEnabled: boolean; localCleanupEnabled: boolean; style: DictationStyle;
  cleanupModel: string; autoPaste: boolean; restoreClipboard: boolean; saveHistory: boolean;
  playSounds: boolean; launchAtLogin: boolean;
  shortcuts: { hold: SpeechShortcut; toggle: SpeechShortcut; edit: SpeechShortcut; cancel: SpeechShortcut };
  vocabulary: VocabularyEntry[]; snippets: SpeechSnippet[]; appStyles: AppStyleRule[];
}
export type WriteProvider = { kind: "openRouter"; modelID: string } | { kind: "local"; modelID: "qwen3_4b_instruct_2507_4bit" | "gemma4_e4b_it_mxfp8" };
export interface WritingNote { id: string; title: string; content: string; hotkey?: WriteHotkey; createdAt: number; updatedAt: number }
export interface WritingState {
  settings: { rewriteProvider: WriteProvider; outputMode: "replaceSelection" | "copyToClipboard" };
  profiles: WritingProfile[]; notes: WritingNote[];
}
export interface WritingProfile {
  id: string;
  name: string;
  instruction: string;
  isEnabled: boolean;
  isBuiltIn: boolean;
  openRouterModelID?: string;
  hotkey?: WriteHotkey;
}
export interface SpeechStatus {
  phase: SpeechPhase;
  microphoneGranted: boolean;
  accessibilityGranted: boolean;
  keyConfigured: boolean;
  shortcutsEnabled: boolean;
  profiles: WritingProfile[];
  writeModel: string;
  writeProvider: string;
  historyCount: number;
  canRetry: boolean;
  limitations: string[];
  screenCaptureGranted: boolean;
  localModelPath: string;
  localModelPresent: boolean;
}
export interface SpeechHistoryEntry {
  id: string;
  date: number;
  rawText: string;
  text: string;
  appName: string;
  duration: number;
}
export type SpeechEvent =
  | { event: "phase"; phase: SpeechPhase }
  | { event: "level"; level: number }
  | { event: "result"; source: "talk" | "write" | "note"; text: string; rawText: string; delivery: string; warning: string }
  | { event: "error"; message: string; recordingPath: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid speech service response.");
  return Object.fromEntries(Object.entries(value));
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid speech service text.");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid speech service flag.");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid speech service number.");
  return value;
}
function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error("Invalid speech service list.");
  return value.map(parse);
}
function parsePhase(value: unknown): SpeechPhase {
  switch (value) {
    case "idle": case "requestingPermission": case "recording": case "transcribing":
    case "formatting": case "inserting": case "success": case "failed": return value;
    default: throw new Error("Invalid speech service phase.");
  }
}
function parseProfile(value: unknown): WritingProfile {
  const item = record(value);
  return {
    id: string(item.id), name: string(item.name), instruction: string(item.instruction),
    isEnabled: boolean(item.isEnabled), isBuiltIn: boolean(item.isBuiltIn),
    ...(typeof item.openRouterModelID === "string" ? { openRouterModelID: item.openRouterModelID } : {}),
    ...(item.hotkey ? { hotkey: parseWriteHotkey(item.hotkey) } : {}),
  };
}
function parseStatus(value: unknown): SpeechStatus {
  const item = record(value);
  return {
    phase: parsePhase(item.phase), microphoneGranted: boolean(item.microphoneGranted),
    accessibilityGranted: boolean(item.accessibilityGranted), keyConfigured: boolean(item.keyConfigured),
    shortcutsEnabled: boolean(item.shortcutsEnabled), profiles: array(item.profiles, parseProfile),
    writeModel: string(item.writeModel), writeProvider: string(item.writeProvider),
    historyCount: number(item.historyCount), canRetry: boolean(item.canRetry),
    limitations: array(item.limitations, string), screenCaptureGranted: boolean(item.screenCaptureGranted),
    localModelPath: string(item.localModelPath), localModelPresent: boolean(item.localModelPresent),
  };
}
function parseStyle(value: unknown): DictationStyle {
  switch (value) { case "natural": case "casual": case "professional": case "verbatim": return value; default: throw new Error("Invalid dictation style."); }
}
function parseShortcut(value: unknown): SpeechShortcut {
  const item = record(value);
  return { keyCode: number(item.keyCode), modifiers: number(item.modifiers), keyLabel: string(item.keyLabel) };
}
function parseWriteHotkey(value: unknown): WriteHotkey {
  const item = record(value);
  return { keyCode: number(item.keyCode), modifiersRawValue: number(item.modifiersRawValue) };
}
function parsePreferences(value: unknown): SpeechPreferences {
  const item = record(value), shortcuts = record(item.shortcuts);
  return {
    screenContextEnabled: boolean(item.screenContextEnabled), memoryEnabled: boolean(item.memoryEnabled), language: string(item.language),
    cleanupEnabled: boolean(item.cleanupEnabled), localCleanupEnabled: boolean(item.localCleanupEnabled), style: parseStyle(item.style),
    cleanupModel: string(item.cleanupModel), autoPaste: boolean(item.autoPaste), restoreClipboard: boolean(item.restoreClipboard),
    saveHistory: boolean(item.saveHistory), playSounds: boolean(item.playSounds), launchAtLogin: boolean(item.launchAtLogin),
    shortcuts: { hold: parseShortcut(shortcuts.hold), toggle: parseShortcut(shortcuts.toggle), edit: parseShortcut(shortcuts.edit), cancel: parseShortcut(shortcuts.cancel) },
    vocabulary: array(item.vocabulary, value => { const entry = record(value); return { id: string(entry.id), spoken: string(entry.spoken), replacement: string(entry.replacement) }; }),
    snippets: array(item.snippets, value => { const entry = record(value); return { id: string(entry.id), trigger: string(entry.trigger), expansion: string(entry.expansion) }; }),
    appStyles: array(item.appStyles, value => { const entry = record(value); return { id: string(entry.id), bundleID: string(entry.bundleID), name: string(entry.name), style: parseStyle(entry.style) }; }),
  };
}
function parseProvider(value: unknown): WriteProvider {
  const item = record(value);
  if (item.kind === "openRouter") return { kind: "openRouter", modelID: string(item.modelID) };
  if (item.kind === "local" && (item.modelID === "qwen3_4b_instruct_2507_4bit" || item.modelID === "gemma4_e4b_it_mxfp8")) return { kind: "local", modelID: item.modelID };
  throw new Error("Invalid writing provider.");
}
function parseNote(value: unknown): WritingNote {
  const item = record(value);
  return { id: string(item.id), title: string(item.title), content: string(item.content), createdAt: number(item.createdAt), updatedAt: number(item.updatedAt), ...(item.hotkey ? { hotkey: parseWriteHotkey(item.hotkey) } : {}) };
}
function parseWriting(value: unknown): WritingState {
  const item = record(value), settings = record(item.settings);
  if (settings.outputMode !== "replaceSelection" && settings.outputMode !== "copyToClipboard") throw new Error("Invalid writing output mode.");
  return { settings: { rewriteProvider: parseProvider(settings.rewriteProvider), outputMode: settings.outputMode }, profiles: array(item.profiles, parseProfile), notes: array(item.notes, parseNote) };
}
function parseHistory(value: unknown): SpeechHistoryEntry {
  const item = record(value);
  return { id: string(item.id), date: number(item.date), rawText: string(item.rawText), text: string(item.text), appName: string(item.appName), duration: number(item.duration) };
}
function parseSource(value: unknown): "talk" | "write" | "note" {
  switch (value) { case "talk": case "write": case "note": return value; default: throw new Error("Invalid speech result source."); }
}
function parseEvent(item: Record<string, unknown>): SpeechEvent {
  switch (item.event) {
    case "phase": return { event: "phase", phase: parsePhase(item.phase) };
    case "level": return { event: "level", level: number(item.level) };
    case "result": return { event: "result", source: parseSource(item.source), text: string(item.text), rawText: string(item.rawText), delivery: string(item.delivery), warning: string(item.warning) };
    case "error": return { event: "error", message: string(item.message), recordingPath: typeof item.recordingPath === "string" ? item.recordingPath : "" };
    default: throw new Error("Unknown speech service event.");
  }
}

interface PendingRequest { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
export interface SpeechClientOptions {
  binaryPath?: string;
  dataDirectory?: string;
  onEvent?: (event: SpeechEvent) => void;
}

export class SpeechClient {
  private readonly process: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly onEvent: (event: SpeechEvent) => void;
  private sequence = 0;
  private closed = false;

  constructor(options: SpeechClientOptions = {}) {
    const binaryPath = options.binaryPath ?? process.env.BUDDYMAC_SPEECH_BINARY ?? [
      join(dirname(process.execPath), "buddymac-speech"),
      resolve(import.meta.dir, "../MacOS/buddymac-speech"),
      resolve(import.meta.dir, "../native/speech/build/buddymac-speech"),
      join(process.cwd(), "native/speech/build/buddymac-speech"),
    ].find(existsSync);
    if (!binaryPath) throw new Error("Build BuddyMac's speech helper with scripts/build-speech.sh.");
    this.onEvent = options.onEvent ?? (() => {});
    this.process = Bun.spawn([binaryPath], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, BUDDYMAC_UI_PID: String(process.pid), ...(options.dataDirectory ? { BUDDYMAC_SPEECH_DATA_DIR: options.dataDirectory } : {}) },
    });
    void this.readOutput();
    void this.process.stderr.pipeTo(new WritableStream({ write() {} })).catch(() => {});
    void this.process.exited.then(code => {
      if (!this.closed) this.rejectAll(new Error(`Speech service exited with status ${code}.`));
      this.closed = true;
    });
  }

  async status(): Promise<SpeechStatus> { return parseStatus(await this.request("status")); }
  async preferences(): Promise<SpeechPreferences> { return parsePreferences(await this.request("preferences")); }
  async savePreferences(preferences: SpeechPreferences): Promise<SpeechPreferences> { return parsePreferences(await this.request("savePreferences", { preferences })); }
  async memory(): Promise<string> { return string(record(await this.request("memory")).text); }
  async saveMemory(text: string): Promise<void> { await this.request("saveMemory", { text }); }
  async writing(): Promise<WritingState> { return parseWriting(await this.request("writing")); }
  async setWriteProvider(provider: WriteProvider): Promise<WritingState> { return parseWriting(await this.request("setWriteProvider", { provider })); }
  async createProfile(options: { name: string; instruction: string }): Promise<WritingProfile> { return parseProfile(await this.request("createProfile", options)); }
  async saveProfile(profile: WritingProfile): Promise<WritingProfile> { return parseProfile(await this.request("saveProfile", { profile })); }
  async moveProfile(id: string, direction: "up" | "down"): Promise<WritingState> { return parseWriting(await this.request("moveProfile", { profileId: id, value: direction })); }
  async deleteProfile(id: string): Promise<void> { await this.request("deleteProfile", { profileId: id }); }
  async createNote(options: { title: string; content: string }): Promise<WritingNote> { return parseNote(await this.request("createNote", { name: options.title, text: options.content })); }
  async saveNote(note: WritingNote): Promise<WritingNote> { return parseNote(await this.request("saveNote", { note })); }
  async deleteNote(id: string): Promise<void> { await this.request("deleteNote", { historyId: id }); }
  async normalizeLocally(text: string): Promise<string> { return string(record(await this.request("normalizeLocally", { text })).text); }
  async downloadLocalCleanup(): Promise<void> { await this.request("downloadLocalCleanup"); }
  async cancelLocalDownload(): Promise<void> { await this.request("cancelLocalDownload"); }
  async requestScreenCapture(): Promise<boolean> { return boolean(record(await this.request("requestScreenCapture")).granted); }
  async start(options: { mode?: "dictate" | "editSelection"; insert?: boolean } = {}): Promise<void> { await this.request("start", { mode: options.mode ?? "dictate", insert: options.insert ?? false }); }
  async stop(): Promise<void> { await this.request("stop"); }
  async cancel(): Promise<void> { await this.request("cancel"); }
  async retry(): Promise<void> { await this.request("retry"); }
  async importAudio(path: string): Promise<void> { await this.request("importAudio", { path }); }
  async rewrite(options: { text: string; profileId?: string }): Promise<{ text: string; delivery: string }> {
    const result = record(await this.request("rewrite", options));
    return { text: string(result.text), delivery: string(result.delivery) };
  }
  async rewriteSelection(options: { profileId?: string } = {}): Promise<{ text: string; delivery: string }> {
    const result = record(await this.request("rewriteSelection", options));
    return { text: string(result.text), delivery: string(result.delivery) };
  }
  async captureSelection(): Promise<{ text: string; appName: string }> {
    const result = record(await this.request("captureSelection"));
    return { text: string(result.text), appName: string(result.appName) };
  }
  async setKey(options: { provider: "openRouter"; value: string }): Promise<void> { await this.request("setKey", { value: options.value }); }
  async removeKey(): Promise<void> { await this.request("removeKey"); }
  async setOutputMode(mode: WritingState["settings"]["outputMode"]): Promise<WritingState> { return parseWriting(await this.request("setOutputMode", { value: mode })); }
  async removeLocalModel(): Promise<void> { await this.request("removeLocalModel"); }
  async history(): Promise<SpeechHistoryEntry[]> { return array(await this.request("history"), parseHistory); }
  async deleteHistory(id: string): Promise<void> { await this.request("deleteHistory", { historyId: id }); }
  async clearHistory(): Promise<void> { await this.request("clearHistory"); }
  async enableShortcuts(enabled: boolean): Promise<void> { await this.request("enableShortcuts", { enabled }); }
  async requestAccessibility(): Promise<boolean> { return boolean(record(await this.request("requestAccessibility")).granted); }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.process.stdin.end();
    this.rejectAll(new Error("Speech service closed."));
    const process = this.process;
    const timeout = setTimeout(() => process.kill(), 1500);
    void process.exited.finally(() => clearTimeout(timeout));
  }

  private request(method: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Speech service is unavailable."));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Speech service did not respond in time."));
      }, method === "downloadLocalCleanup" ? 3_660_000 : 300_000);
      this.pending.set(id, { resolve, reject, timeout });
      try { this.process.stdin.write(JSON.stringify({ ...fields, id, method }) + "\n"); }
      catch (error) { clearTimeout(timeout); this.pending.delete(id); reject(error); }
    });
  }

  private async readOutput(): Promise<void> {
    const reader = this.process.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line) this.receive(JSON.parse(line));
          newline = buffer.indexOf("\n");
        }
      }
    } catch {
      this.rejectAll(new Error("The speech service connection failed."));
    } finally { reader.releaseLock(); }
  }

  private receive(value: unknown): void {
    const item = record(value);
    if (typeof item.id === "number") {
      const request = this.pending.get(item.id);
      if (!request) return;
      this.pending.delete(item.id);
      clearTimeout(request.timeout);
      if (item.ok === true) request.resolve(item.result);
      else request.reject(new Error(string(item.error)));
    } else this.onEvent(parseEvent(item));
  }
  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) { clearTimeout(request.timeout); request.reject(error); }
    this.pending.clear();
  }
}

export function speechHistoryDate(entry: SpeechHistoryEntry): Date {
  return new Date((entry.date + 978_307_200) * 1000);
}
