import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { SpeechClient, type SpeechEvent, type SpeechPreferences, type WriteProvider } from "../src/speech";

// Run only after the UI owner has paused all other SpeechClient instances.
if (!process.argv.includes("--run")) {
  console.log("Ready. After coordinating exclusive speech-store access, run: bun scripts/verify-live-speech-features.ts --run");
  process.exit(0);
}
if (process.env.BUDDYMAC_SPEECH_DATA_DIR) throw new Error("Live verification requires the default BuddyMac store.");
const binaryPath = join(homedir(), "Applications/BuddyMac.app/Contents/MacOS/buddymac-speech");
if (!existsSync(binaryPath)) throw new Error("The installed signed speech helper is missing.");
const taskRoot = await mkdtemp("/private/tmp/buddymac-live-speech-features-");
await chmod(taskRoot, 0o700);
const memoryPath = join(homedir(), "Library/Application Support/BuddyMac/Speech/memory.md");
const hadMemoryFile = existsSync(memoryPath);
const marker = `Speech fixture ${crypto.randomUUID()}`;
const profiles = new Set<string>();
const history = new Set<string>();
const checks: { feature: string; passed: boolean; details: Record<string, unknown> }[] = [];
const restoreErrors: string[] = [];
let receive: (event: SpeechEvent) => void = () => {};
const client = new SpeechClient({ binaryPath, onEvent: event => receive(event) });
let original: { preferences: SpeechPreferences; provider: WriteProvider; memory: string } | undefined;
let originalHistoryIDs: Set<string> | undefined;
let changed = false;
let cloudOperations = 0;
let failed: string | undefined;
const started = Date.now();
const check = (feature: string, passed: boolean, details: Record<string, unknown>) => {
  checks.push({ feature, passed, details });
};
function reserveOperation() {
  if (++cloudOperations > 5) throw new Error("The five-operation live test limit was reached.");
}
async function synthesize(name: string, text: string): Promise<string> {
  const path = join(taskRoot, `${name}.wav`);
  const child = Bun.spawn(["/usr/bin/say", "-v", "Samantha", "--file-format=WAVE", "--data-format=LEI16@16000", "-o", path, text], { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  await new Response(child.stderr).text();
  if (await child.exited !== 0) throw new Error("Synthetic speech generation failed.");
  return path;
}
async function importFixture(path: string): Promise<Extract<SpeechEvent, { event: "result" }>> {
  reserveOperation();
  const before = new Set((await client.history()).map(entry => entry.id));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = new Promise<Extract<SpeechEvent, { event: "result" }>>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Synthetic transcription exceeded 90 seconds.")), 90_000);
    receive = event => {
      if (event.event === "result" && event.source === "talk") resolve(event);
      else if (event.event === "error") reject(new Error(event.message));
    };
  });
  // Handle an early event even if importAudio has not returned its command response yet.
  void result.catch(() => {});
  try {
    await client.importAudio(path);
    const event = await result;
    const added = (await client.history()).filter(entry => !before.has(entry.id) && entry.text === event.text && entry.rawText === event.rawText && entry.appName === "BuddyMac");
    for (const entry of added) history.add(entry.id);
    if (added.length !== 1) throw new Error("Could not identify exactly one fixture history entry; stopping for safe cleanup.");
    if (event.delivery !== "ready") throw new Error("A fixture unexpectedly requested external delivery.");
    return event;
  } finally { clearTimeout(timer); receive = () => {}; }
}
async function restore(action: () => Promise<unknown>, description: string) {
  try { await action(); } catch { restoreErrors.push(description); }
}

try {
  const status = await client.status();
  if (!["idle", "success", "failed"].includes(status.phase)) throw new Error("The speech helper is busy.");
  if (!status.keyConfigured) throw new Error("BuddyMac's dedicated OpenRouter key is not configured.");
  if (status.historyCount > 190) throw new Error("History has insufficient headroom for safe live fixtures.");
  original = { preferences: await client.preferences(), provider: (await client.writing()).settings.rewriteProvider, memory: await client.memory() };
  originalHistoryIDs = new Set((await client.history()).map(entry => entry.id));
  if (!original.preferences.saveHistory && originalHistoryIDs.size > 0) throw new Error("History is disabled but entries remain; restoring that preference would clear them.");
  await writeFile(join(taskRoot, "restore.json"), JSON.stringify({ ...original, hadMemoryFile, originalHistoryIDs: [...originalHistoryIDs] }), { mode: 0o600 });
  const vocabularyAudio = await synthesize("vocabulary", "Um, please send the buddy mac update on Monday, actually Friday. Synthetic signature.");
  const memoryAudio = await synthesize("memory", "Please send the quartz update tomorrow.");
  changed = true;
  await client.setWriteProvider({ kind: "openRouter", modelID: "openai/gpt-5.4-nano" });

  const profile = await client.createProfile({ name: marker, instruction: "Rewrite the input as a short polite request. Begin with Please. Keep the destination and every stated fact. Return only the rewritten text." });
  profiles.add(profile.id);
  reserveOperation();
  const polite = await client.rewrite({ profileId: profile.id, text: "send the report to Nora tomorrow" });
  check("Custom profile instruction", /^please\b/i.test(polite.text) && /Nora/.test(polite.text) && /tomorrow/i.test(polite.text) && polite.delivery === "ready", { text: polite.text, delivery: polite.delivery });
  const edited = await client.saveProfile({ ...profile, instruction: "Fix grammar only and return the entire corrected sentence in uppercase. Do not add or remove facts. Return only the final text.", openRouterModelID: "openai/gpt-5.4-nano" });
  reserveOperation();
  const upper = await client.rewrite({ profileId: edited.id, text: "the report is ready for Nora tomorrow" });
  check("Edited profile and model override", upper.text === upper.text.toUpperCase() && /NORA/.test(upper.text) && /TOMORROW/.test(upper.text) && upper.delivery === "ready", { text: upper.text, delivery: upper.delivery, model: edited.openRouterModelID });

  const fixturePreferences: SpeechPreferences = {
    ...original.preferences, language: "en", style: "professional", autoPaste: false, restoreClipboard: true,
    playSounds: false, screenContextEnabled: false, memoryEnabled: false,
    cleanupEnabled: true, localCleanupEnabled: false, cleanupModel: "google/gemini-2.5-flash-lite", saveHistory: true,
    vocabulary: [{ id: crypto.randomUUID(), spoken: "buddy mac", replacement: "BuddyMac" }],
    snippets: [{ id: crypto.randomUUID(), trigger: "synthetic signature", expansion: "Regards,\nFixture Team" }], appStyles: [],
  };
  await client.savePreferences(fixturePreferences);
  const vocabulary = await importFixture(vocabularyAudio);
  check("Professional cloud cleanup, self-correction, vocabulary and snippet", vocabulary.warning === "" && /BuddyMac/.test(vocabulary.text) && /Friday/i.test(vocabulary.text) && !/Monday|actually|\bum\b/i.test(vocabulary.text) && vocabulary.text.includes("Regards,\nFixture Team"), { text: vocabulary.text, rawText: vocabulary.rawText, warning: vocabulary.warning });

  await client.saveMemory("For the synthetic project name pronounced quartz, the preferred spelling is QuArTz. Apply this spelling only when the name was spoken. Never add facts or extra words.");
  await client.savePreferences({ ...fixturePreferences, vocabulary: [], snippets: [], memoryEnabled: true });
  const enabled = await importFixture(memoryAudio);
  check("Memory spelling preference enabled", enabled.warning === "" && enabled.text.includes("QuArTz") && /tomorrow/i.test(enabled.text), { text: enabled.text, rawText: enabled.rawText, warning: enabled.warning });
  await client.savePreferences({ ...fixturePreferences, vocabulary: [], snippets: [], memoryEnabled: false });
  const disabled = await importFixture(memoryAudio);
  const wording = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  check("Memory preference disabled", disabled.warning === "" && enabled.rawText === disabled.rawText && !disabled.text.includes("QuArTz") && wording(disabled.text) === wording(disabled.rawText) && /tomorrow/i.test(disabled.text), { text: disabled.text, rawText: disabled.rawText, warning: disabled.warning, sameRawTranscriptAcrossToggle: enabled.rawText === disabled.rawText });
} catch (error) {
  failed = error instanceof Error ? error.message : String(error);
} finally {
  if (changed && original) {
    await restore(() => client.cancel(), "Cancel unfinished fixture operation");
    for (const id of history) await restore(() => client.deleteHistory(id), "Delete tracked fixture history entry");
    for (const id of profiles) await restore(() => client.deleteProfile(id), "Delete tracked fixture writing profile");
    await restore(() => client.saveMemory(original!.memory), "Restore original memory");
    if (!hadMemoryFile && !restoreErrors.includes("Restore original memory")) await restore(() => rm(memoryPath, { force: true }), "Restore memory-file absence");
    await restore(() => client.setWriteProvider(original!.provider), "Restore original writing provider");
    await restore(async () => {
      const remaining = await client.history();
      if (!original!.preferences.saveHistory && remaining.some(entry => !originalHistoryIDs?.has(entry.id))) {
        throw new Error("Concurrent history appeared; do not clear unrelated entries while restoring the disabled history preference.");
      }
      await client.savePreferences(original!.preferences);
    }, "Restore original Talk preferences");
    await restore(async () => {
      if (JSON.stringify(await client.preferences()) !== JSON.stringify(original!.preferences)) throw new Error("Preferences differ.");
      if (JSON.stringify((await client.writing()).settings.rewriteProvider) !== JSON.stringify(original!.provider)) throw new Error("Provider differs.");
      if (await client.memory() !== original!.memory) throw new Error("Memory differs.");
      const remaining = new Set((await client.history()).map(entry => entry.id));
      if ([...originalHistoryIDs!].some(id => !remaining.has(id))) throw new Error("Original history is missing.");
      if ([...remaining].some(id => !originalHistoryIDs!.has(id))) throw new Error("Untracked history remains; it was not deleted.");
    }, "Verify restored state and original history IDs");
  }
  client.dispose();
  const passed = !failed && restoreErrors.length === 0 && checks.length === 5 && checks.every(item => item.passed);
  const evidence = {
    verifiedAt: new Date().toISOString(), passed, elapsedMs: Date.now() - started, installedHelper: binaryPath,
    cloudOperations, maximumCloudOperations: 5, maximumProviderRequestsIncludingTranscriptionFallback: 11,
    checks, failure: failed ?? null, restoration: { passed: restoreErrors.length === 0, errors: restoreErrors, trackedProfiles: profiles.size, trackedHistoryEntries: history.size },
    safety: { microphone: false, gui: false, externalInsertion: false, keyExport: false, originalMemoryInEvidence: false },
    limits: ["App-specific style selection and application/screen context require a captured external destination and are not exercised by importAudio.", "These short semantic assertions verify the chosen fixtures, not arbitrary rewriting quality.", "The OpenRouter key's external $5 cap is the spend bound; this script limits operation count and uses short fixtures."],
    ...(restoreErrors.length ? { privateRecoveryDirectory: taskRoot } : {}),
  };
  await mkdir("evidence/live", { recursive: true });
  await writeFile("evidence/live/speech-features.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
  if (!restoreErrors.length) await rm(taskRoot, { recursive: true, force: true });
  if (!passed) process.exitCode = 1;
}
