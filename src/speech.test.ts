import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir, stat, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpeechClient, speechHistoryDate, type AppStyleRule, type SpeechEvent } from "./speech";

const clients: SpeechClient[] = [];
const rawProcesses: Bun.Subprocess<"pipe", "pipe", "pipe">[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose();
  for (const process of rawProcesses.splice(0)) { process.kill(); await process.exited; }
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "buddymac-speech-test-"));
  directories.push(path);
  return path;
}
function client(dataDirectory: string) {
  const value = new SpeechClient({ dataDirectory });
  clients.push(value);
  return value;
}

describe("bundled speech service", () => {
  test("isolated status starts no capture, registers no hotkeys and exposes missing engines", async () => {
    const service = client(await directory());
    const status = await service.status();
    expect(status.phase).toBe("idle");
    expect(status.keyConfigured).toBe(false);
    expect(status.shortcutsEnabled).toBe(false);
    expect(status.profiles[0]?.name).toBe("Standard");
    expect(status.limitations.length).toBeGreaterThan(0);
    await expect(service.start()).rejects.toThrow("Add an OpenRouter key");
    expect((await service.status()).phase).toBe("idle");
    await expect(service.stop()).rejects.toThrow("no active recording");
    await expect(service.retry()).rejects.toThrow("no failed recording");
    await service.cancel();
    await expect(service.setKey({ provider: "openRouter", value: "test-placeholder" })).rejects.toThrow("disabled in isolated mode");
  });

  test("history retains Swift dates and deletes only the chosen ID across restarts", async () => {
    const root = await directory();
    const entry = { id: "D6EF703F-F03B-489E-91FA-22538493ED3A", date: 0, rawText: "Synthetic source.", text: "Synthetic result.", appName: "Fixture", duration: 2 };
    const other = { ...entry, id: "E38BABE1-61DD-490D-AE65-E6B6F8E3DDF8" };
    await writeFile(join(root, "settings.json"), JSON.stringify({ preferences: {}, history: [entry, other] }));
    const service = client(root);
    expect((await service.status()).historyCount).toBe(2);
    const history = await service.history();
    expect(history).toHaveLength(2);
    const first = history[0];
    if (!first) throw new Error("The fixture history was not loaded.");
    expect(speechHistoryDate(first).toISOString()).toBe("2001-01-01T00:00:00.000Z");
    await service.deleteHistory(entry.id);
    expect((await service.history()).map(item => item.id)).toEqual([other.id]);
    service.dispose();
    const next = client(root);
    expect((await next.history()).map(item => item.id)).toEqual([other.id]);
    await next.clearHistory();
    expect(await next.history()).toEqual([]);
    const saved = JSON.parse(await readFile(join(root, "settings.json"), "utf8"));
    expect(saved.history).toEqual([]);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, "settings.json"))).mode & 0o777).toBe(0o600);
  });

  test("preserves an imported local provider and refuses silent cloud substitution for Write", async () => {
    const root = await directory();
    await mkdir(join(root, "Imported"));
    const settings = Buffer.from(JSON.stringify({ rewriteProvider: { kind: "local", modelID: "qwen3_4b_instruct_2507_4bit" }, outputMode: "copyToClipboard" })).toString("base64");
    await writeFile(join(root, "Imported/BuddyWrite.plist"), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>BuddyGrammar.settings</key><data>${settings}</data></dict></plist>`);
    const service = client(root);
    expect((await service.status()).writeProvider).toBe("local");
    await expect(service.rewrite({ text: "Synthetic source." })).rejects.toThrow("local MLX model");
    expect((await service.status()).phase).toBe("idle");
  });

  test("edits Talk preferences, memory, Write profiles and notes in the new store", async () => {
    const root = await directory();
    const service = client(root);
    const preferences = await service.preferences();
    expect(preferences.shortcuts.hold.modifiers).toBeGreaterThan(0);
    const vocabulary = { id: crypto.randomUUID().toUpperCase(), spoken: "buddy mac", replacement: "BuddyMac" };
    const snippet = { id: crypto.randomUUID().toUpperCase(), trigger: "test phrase", expansion: "Synthetic expansion." };
    const rule: AppStyleRule = { id: crypto.randomUUID().toUpperCase(), bundleID: "org.example.Fixture", name: "Fixture", style: "professional" };
    const saved = await service.savePreferences({ ...preferences, language: "en", style: "casual", vocabulary: [vocabulary], snippets: [snippet], appStyles: [rule] });
    expect(saved.vocabulary).toEqual([vocabulary]);
    expect(saved.snippets).toEqual([snippet]);
    expect(saved.appStyles).toEqual([rule]);
    await service.saveMemory("Synthetic memory preferences.");
    expect(await service.memory()).toBe("Synthetic memory preferences.");
    await expect(service.saveMemory("x".repeat(32769))).rejects.toThrow("32 KB");
    const profile = await service.createProfile({ name: "Fixture", instruction: "Correct synthetic text." });
    const edited = await service.saveProfile({ ...profile, name: "Updated fixture", openRouterModelID: "google/fixture" });
    expect(edited.name).toBe("Updated fixture");
    const note = await service.createNote({ title: "Fixture", content: "Synthetic note." });
    expect((await service.saveNote({ ...note, content: "Updated synthetic note." })).content).toBe("Updated synthetic note.");
    await service.setWriteProvider({ kind: "openRouter", modelID: "google/fixture" });
    expect((await service.writing()).settings.rewriteProvider.modelID).toBe("google/fixture");
    service.dispose();
    const next = client(root);
    expect((await next.preferences()).language).toBe("en");
    expect((await next.writing()).profiles.some(item => item.id === profile.id && item.name === "Updated fixture")).toBe(true);
    expect((await next.writing()).notes[0]?.content).toBe("Updated synthetic note.");
    await expect(next.deleteProfile("B48FDF75-0C5D-4A96-B48D-29D160C6B470")).rejects.toThrow("cannot be deleted");
    await next.deleteProfile(profile.id);
    await next.saveNote({ ...note, hotkey: { keyCode: 18, modifiersRawValue: 1179648 } });
    await expect(next.enableShortcuts(true)).rejects.toThrow("share a shortcut");
    expect((await next.status()).shortcutsEnabled).toBe(false);
    await next.deleteNote(note.id);
    expect((await next.writing()).notes).toEqual([]);
    await expect(next.normalizeLocally("um a synthetic phrase")).rejects.toThrow("Download S1-mini");
  });

  test("malformed settings fail without overwriting the original data", async () => {
    const root = await directory();
    const original = "{ malformed }";
    await writeFile(join(root, "settings.json"), original);
    const service = client(root);
    await expect(service.status()).rejects.toThrow("exited");
    expect(await readFile(join(root, "settings.json"), "utf8")).toBe(original);
  });
});

async function protocol(root: string) {
  const process = Bun.spawn([join(import.meta.dir, "../native/speech/build/buddymac-speech")], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...Bun.env, BUDDYMAC_SPEECH_DATA_DIR: root },
  });
  rawProcesses.push(process);
  void process.stderr.pipeTo(new WritableStream({ write() {} })).catch(() => {});
  const lines = process.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  return async (input: string | Record<string, unknown>): Promise<Record<string, unknown>> => {
    process.stdin.write((typeof input === "string" ? input : JSON.stringify(input)) + "\n");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          while (!pending.includes("\n")) {
            const chunk = await lines.read();
            if (chunk.done) throw new Error("Protocol helper exited unexpectedly.");
            pending += chunk.value;
          }
          const end = pending.indexOf("\n");
          const value: Record<string, unknown> = JSON.parse(pending.slice(0, end));
          pending = pending.slice(end + 1);
          return value;
        })(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("No protocol response within 2 seconds.")), 2000); }),
      ]);
    } finally { clearTimeout(timeout); }
  };
}

describe("speech feature regression coverage", () => {
  test("profile ordering keeps Standard first and protects its content across restart", async () => {
    const root = await directory(), service = client(root);
    const standard = (await service.writing()).profiles[0];
    if (!standard) throw new Error("Missing Standard profile.");
    const first = await service.createProfile({ name: "First", instruction: "Synthetic first." });
    const second = await service.createProfile({ name: "Second", instruction: "Synthetic second." });
    expect((await service.moveProfile(second.id, "up")).profiles.map(p => p.id)).toEqual([standard.id, second.id, first.id]);
    expect((await service.moveProfile(second.id, "up")).profiles.map(p => p.id)).toEqual([standard.id, second.id, first.id]);
    expect((await service.moveProfile(second.id, "down")).profiles.map(p => p.id)).toEqual([standard.id, first.id, second.id]);
    expect((await service.moveProfile(second.id, "down")).profiles.map(p => p.id)).toEqual([standard.id, first.id, second.id]);
    await expect(service.moveProfile(standard.id, "down")).rejects.toThrow("stays first");
    const locked = await service.saveProfile({ ...standard, name: "Changed", instruction: "Changed", isBuiltIn: false, openRouterModelID: "openai/synthetic" });
    expect(locked.name).toBe(standard.name);
    expect(locked.instruction).toBe(standard.instruction);
    expect(locked.isBuiltIn).toBe(true);
    expect(locked.openRouterModelID).toBe("openai/synthetic");
    expect((await service.saveProfile({ ...locked, openRouterModelID: "  " })).openRouterModelID).toBeUndefined();
    expect((await service.saveProfile({ ...first, isEnabled: true, isBuiltIn: true })).isEnabled).toBe(false);
    expect((await service.writing()).profiles[1]?.isBuiltIn).toBe(false);
    await service.deleteProfile(first.id);
    service.dispose();
    expect((await client(root).writing()).profiles.map(p => p.id)).toEqual([standard.id, second.id]);
  });

  test("notes preserve Unicode, multiline content and timestamps and delete persistently", async () => {
    const root = await directory(), service = client(root);
    const first = await service.createNote({ title: "Unicode", content: "Ciao 👋\nSecond line\n" });
    const second = await service.createNote({ title: "Empty", content: "" });
    expect((await service.writing()).notes.map(n => n.id)).toEqual([second.id, first.id]);
    const saved = await service.saveNote({ ...first, title: "Updated", content: "È sintetico.\n👋", hotkey: { keyCode: 20, modifiersRawValue: 1179648 } });
    expect(saved.createdAt).toBe(first.createdAt);
    expect(saved.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
    expect(saved.content).toBe("È sintetico.\n👋");
    await expect(service.saveNote({ ...saved, id: crypto.randomUUID() })).rejects.toThrow("existing note");
    await expect(service.deleteNote("invalid")).rejects.toThrow("Choose a note");
    await service.deleteNote(second.id);
    service.dispose();
    expect((await client(root).writing()).notes).toEqual([saved]);
    expect((await stat(join(root, "writing.json"))).mode & 0o777).toBe(0o600);
  });

  test("disabling history clears active entries permanently and leaves snapshots untouched", async () => {
    const root = await directory();
    const fixture = JSON.stringify({ preferences: {}, history: [{ id: crypto.randomUUID(), date: 0, rawText: "Synthetic", text: "Synthetic", appName: "Fixture", duration: 1 }] });
    await mkdir(join(root, "Imported"));
    await writeFile(join(root, "Imported/BuddyTalk-settings.json"), fixture);
    await writeFile(join(root, "settings.json"), fixture);
    const service = client(root);
    expect(await service.history()).toHaveLength(1);
    await service.savePreferences({ ...await service.preferences(), saveHistory: false });
    expect(await service.history()).toEqual([]);
    expect(await readFile(join(root, "Imported/BuddyTalk-settings.json"), "utf8")).toBe(fixture);
    service.dispose();
    const next = client(root);
    expect((await next.preferences()).saveHistory).toBe(false);
    expect(await next.history()).toEqual([]);
    await next.savePreferences({ ...await next.preferences(), saveHistory: true });
    expect(await next.history()).toEqual([]);
  });

  test("Talk shortcut validation rejects unsafe keys and duplicates without changing preferences", async () => {
    const service = client(await directory()), preferences = await service.preferences();
    const invalid = [
      { keyCode: 0, modifiers: 0, keyLabel: "A" },
      { keyCode: 55, modifiers: 0, keyLabel: "Left Command" },
      { keyCode: 63, modifiers: 256, keyLabel: "Fn" },
      { keyCode: 128, modifiers: 256, keyLabel: "Invalid" },
      { keyCode: 0, modifiers: 1, keyLabel: "A" },
      { keyCode: 0, modifiers: 256, keyLabel: "" },
      preferences.shortcuts.toggle,
    ];
    for (const hold of invalid) {
      await expect(service.savePreferences({ ...preferences, shortcuts: { ...preferences.shortcuts, hold } })).rejects.toThrow();
      expect(await service.preferences()).toEqual(preferences);
    }
    const fn = { keyCode: 63, modifiers: 0, keyLabel: "Fn" };
    expect((await service.savePreferences({ ...preferences, shortcuts: { ...preferences.shortcuts, hold: fn } })).shortcuts.hold).toEqual(fn);
    expect((await service.status()).shortcutsEnabled).toBe(false);
  });

  test("combined shortcut conflicts fail before registration for profiles, Talk and notes", async () => {
    const service = client(await directory());
    const standard = (await service.writing()).profiles[0];
    if (!standard?.hotkey) throw new Error("Missing Standard shortcut.");
    const profile = await service.createProfile({ name: "Conflict", instruction: "Synthetic." });
    await service.saveProfile({ ...profile, isEnabled: true, hotkey: standard.hotkey });
    await expect(service.enableShortcuts(true)).rejects.toThrow("share a shortcut");
    await service.saveProfile({ ...profile, isEnabled: true, hotkey: { keyCode: 49, modifiersRawValue: 786432 } });
    await expect(service.enableShortcuts(true)).rejects.toThrow("share a shortcut");
    await service.deleteProfile(profile.id);
    const note = await service.createNote({ title: "Conflict", content: "Synthetic" });
    await service.saveNote({ ...note, hotkey: standard.hotkey });
    await expect(service.enableShortcuts(true)).rejects.toThrow("share a shortcut");
    expect((await service.status()).shortcutsEnabled).toBe(false);
    await service.enableShortcuts(false);
  });

  test("invalid writing shortcuts and model IDs fail without saving changes", async () => {
    const service = client(await directory());
    const profile = await service.createProfile({ name: "Fixture", instruction: "Synthetic" });
    const note = await service.createNote({ title: "Fixture", content: "Synthetic" });
    for (const hotkey of [{ keyCode: 0, modifiersRawValue: 0 }, { keyCode: 200, modifiersRawValue: 1179648 }, { keyCode: 55, modifiersRawValue: 1179648 }, { keyCode: 0, modifiersRawValue: 1 }]) {
      await expect(service.saveProfile({ ...profile, isEnabled: true, hotkey })).rejects.toThrow("shortcut");
      await expect(service.saveNote({ ...note, hotkey })).rejects.toThrow("shortcut");
    }
    const before = await service.writing();
    await expect(service.setWriteProvider({ kind: "openRouter", modelID: "invalid" })).rejects.toThrow("valid OpenRouter");
    await expect(service.saveProfile({ ...profile, openRouterModelID: "invalid" })).rejects.toThrow("valid OpenRouter");
    expect(await service.writing()).toEqual(before);
  });

  test("malformed protocol fields return correlated errors and leave service usable", async () => {
    const exchange = await protocol(await directory());
    const invalid = [
      { id: 1, method: "start", mode: "invalid" },
      { id: 2, method: "saveNote", note: { id: "invalid" } },
      { id: 3, method: "setWriteProvider", provider: { kind: "local", modelID: "unknown" } },
      { id: 4, method: "moveProfile", profileId: crypto.randomUUID(), value: "sideways" },
      { id: 5, method: "savePreferences", preferences: { style: "unknown" } },
      { id: 6, method: "unsupported" },
      { id: 7, method: "rewrite", text: 123 },
    ];
    for (const command of invalid) {
      const response = await exchange(command);
      expect(response.id).toBe(command.id);
      expect(response.ok).toBe(false);
      expect(typeof response.error).toBe("string");
    }
    expect((await exchange("{ invalid JSON")).event).toBe("error");
    expect((await exchange({ id: 8, method: "status" })).ok).toBe(true);
  });

  test("audio validation rejects invalid inputs without capture or provider work", async () => {
    const root = await directory(), service = client(root);
    await writeFile(join(root, "invalid.wav"), "synthetic invalid audio");
    await writeFile(join(root, "large.wav"), Buffer.alloc(24 * 1024 * 1024 + 1));
    await expect(service.importAudio(join(root, "unsupported.txt"))).rejects.toThrow("WAV, MP3, or FLAC");
    await expect(service.importAudio(join(root, "missing.wav"))).rejects.toThrow();
    await expect(service.importAudio(join(root, "invalid.wav"))).rejects.toThrow();
    await expect(service.importAudio(join(root, "large.wav"))).rejects.toThrow("24 MB");
    await expect(service.rewrite({ text: "  \n" })).rejects.toThrow("enter text");
    await expect(service.rewrite({ text: "Synthetic", profileId: crypto.randomUUID() })).rejects.toThrow("unavailable");
    await expect(service.normalizeLocally("")).rejects.toThrow("Enter text");
    const preferences = await service.preferences();
    await service.savePreferences({ ...preferences, language: "it" });
    await expect(service.normalizeLocally("Synthetic")).rejects.toThrow("Choose English");
    expect((await service.status()).phase).toBe("idle");
    expect((await service.status()).canRetry).toBe(false);
  });

  test("memory applies UTF-8 byte limit and failed writes preserve previous contents", async () => {
    const service = client(await directory());
    const maximum = "é".repeat(16384);
    await service.saveMemory(maximum);
    expect(await service.memory()).toBe(maximum);
    await expect(service.saveMemory(maximum + "a")).rejects.toThrow("32 KB");
    expect(await service.memory()).toBe(maximum);
    await service.saveMemory("");
    expect(await service.memory()).toBe("");
  });

  test("synthetic audio survives a no-key failure and retry without saving history", async () => {
    const root = await directory();
    const wave = Buffer.alloc(44 + 32000);
    wave.write("RIFF", 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
    wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(16000, 24); wave.writeUInt32LE(32000, 28);
    wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(32000, 40);
    const path = join(root, "synthetic-silence.wav");
    await writeFile(path, wave);
    const events: SpeechEvent[] = [];
    const service = new SpeechClient({ dataDirectory: root, onEvent: event => events.push(event) });
    clients.push(service);
    await service.savePreferences({ ...await service.preferences(), saveHistory: false });
    const waitForFailure = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const status = await service.status();
        if (status.phase === "failed") return status;
        await Bun.sleep(5);
      }
      throw new Error("Synthetic import did not fail promptly without a key.");
    };
    await service.importAudio(path);
    expect((await waitForFailure()).canRetry).toBe(true);
    expect(events.some(event => event.event === "error" && event.recordingPath === path && event.message.includes("Add an OpenRouter key") && event.needs.length === 0)).toBe(true);
    expect(await readFile(path)).toEqual(wave);
    expect(await service.history()).toEqual([]);
    await service.retry();
    expect((await waitForFailure()).canRetry).toBe(true);
    expect(await readFile(path)).toEqual(wave);
    await service.cancel();
    expect((await service.status()).phase).toBe("idle");
    expect(await service.history()).toEqual([]);
  });

  test("dictation pill is off until BuddyMac turns it on and previews only known phases", async () => {
    const root = await directory();
    const events: SpeechEvent[] = [];
    const service = new SpeechClient({ dataDirectory: root, onEvent: event => events.push(event) });
    clients.push(service);
    expect(await service.setOverlay(true)).toBe(true);
    expect(await service.setOverlay(false)).toBe(false);
    await expect(service.previewOverlay({ phase: "listening" as never })).rejects.toThrow("Choose a dictation phase");
    await expect(service.start()).rejects.toThrow("Add an OpenRouter key");
    expect(events.filter(event => event.event === "phase")).toEqual([]);
    expect((await service.status()).phase).toBe("idle");
  });

  test("corrupt writing data fails without replacing either active data or import snapshot", async () => {
    const root = await directory();
    await mkdir(join(root, "Imported"));
    const original = "{ broken writing data }";
    const snapshot = '<?xml version="1.0"?><plist version="1.0"><dict/></plist>';
    await writeFile(join(root, "writing.json"), original);
    await writeFile(join(root, "Imported/BuddyWrite.plist"), snapshot);
    await expect(client(root).writing()).rejects.toThrow("exited");
    expect(await readFile(join(root, "writing.json"), "utf8")).toBe(original);
    expect(await readFile(join(root, "Imported/BuddyWrite.plist"), "utf8")).toBe(snapshot);
  });
});

const cachedModel = process.env.BUDDYMAC_TEST_S1_MODEL;
test.skipIf(!cachedModel || !existsSync(cachedModel))("cached S1 protects vocabulary/snippets, rejects overlap and cancels to idle", async () => {
  if (!cachedModel) throw new Error("Set BUDDYMAC_TEST_S1_MODEL to existing verified weights.");
  const root = await directory();
  await mkdir(join(root, "models"));
  await symlink(cachedModel, join(root, "models/s1-mini-q4_k_m.gguf"));
  const events: SpeechEvent[] = [];
  let onFormatting: (() => void) | undefined;
  const service = new SpeechClient({ dataDirectory: root, onEvent: event => {
    events.push(event);
    if (event.event === "phase" && event.phase === "formatting") onFormatting?.();
  } });
  clients.push(service);
  await service.savePreferences({ ...await service.preferences(), language: "en", localCleanupEnabled: true,
    vocabulary: [{ id: crypto.randomUUID(), spoken: "buddy mac", replacement: "BuddyMac" }],
    snippets: [{ id: crypto.randomUUID(), trigger: "synthetic signature", expansion: "Exact synthetic signature.\nDo not edit." }],
  });
  const result = await service.normalizeLocally("um hello buddy mac");
  expect(result).toContain("BuddyMac");
  expect(events.some(event => event.event === "phase" && event.phase === "formatting")).toBe(true);
  expect((await service.status()).phase).toBe("success");
  const protectedResult = await service.normalizeLocally("synthetic signature").then(
    text => ({ kind: "success" as const, text }),
    error => ({ kind: "rejected" as const, error }),
  );
  if (protectedResult.kind === "success") expect(protectedResult.text).toBe("Exact synthetic signature.\nDo not edit.");
  else {
    expect(protectedResult.error).toBeInstanceOf(Error);
    expect(protectedResult.error.message).toContain("changed a protected snippet");
    expect((await service.status()).phase).toBe("failed");
  }
  events.splice(0);
  let overlap: Promise<{ text?: string; error?: unknown }> | undefined;
  let cancellation: Promise<void> | undefined;
  onFormatting = () => {
    onFormatting = undefined;
    overlap = service.normalizeLocally("Overlapping synthetic request").then(text => ({ text }), error => ({ error }));
    cancellation = service.cancel();
  };
  await expect(service.normalizeLocally("um this synthetic sentence is used to test cancellation before cleanup completes")).rejects.toThrow();
  expect(overlap).toBeDefined();
  expect(cancellation).toBeDefined();
  const overlapResult = await overlap;
  expect(overlapResult?.error).toBeInstanceOf(Error);
  if (!(overlapResult?.error instanceof Error)) throw new Error("Overlapping cleanup was not rejected.");
  expect(overlapResult.error.message).toContain("idle");
  await cancellation;
  expect((await service.status()).phase).toBe("idle");
  expect((await service.status()).canRetry).toBe(false);
  expect(await service.history()).toEqual([]);
}, 120_000);
