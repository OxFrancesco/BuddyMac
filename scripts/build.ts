import { copyFile, cp, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const dist = join(root, "dist");
const stage = join(dist, "BuddyMac.stage.app");
const app = join(dist, "BuddyMac.app");
const macos = join(stage, "Contents/MacOS");
const resources = join(stage, "Contents/Resources");
const framework = join(stage, "Contents/Frameworks/llama.framework");
const identityName = "Developer ID Application: Francesco Oddo (G2442WAF29)";
const entitlements = join(root, "scripts/app-entitlements.plist");

async function run(args: string[], capture = false): Promise<string> {
  const child = Bun.spawn(args, { cwd: root, stdin: "ignore", stdout: capture ? "pipe" : "inherit", stderr: "inherit", env: { ...process.env } });
  const output = capture ? await new Response(child.stdout).text() : "";
  if (await child.exited !== 0) throw new Error(`Build command failed: ${args[0]}`);
  return output;
}

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("This build targets the current Apple Silicon Mac.");
await run([process.execPath, "run", "typecheck"]);
const identities = await run(["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"], true);
const identityLine = identities.split("\n").find(line => line.includes(`"${identityName}"`));
const identity = identityLine?.match(/\b([A-F0-9]{40})\b/)?.[1];
if (!identity) throw new Error(`Code signing identity unavailable: ${identityName}. Run the build with access to the login Keychain.`);

for (const script of ["build-platform.sh", "build-edge.sh", "build-panel.sh", "build-files.sh", "build-dock.sh", "build-focus.sh", "build-focus-app.sh", "build-speech.sh"]) {
  await run(["/bin/zsh", join(root, "scripts", script)]);
}
await run([process.execPath, "native/liny/build.ts"]);
await mkdir(dist, { recursive: true });
await rm(stage, { recursive: true, force: true });
await mkdir(macos, { recursive: true });
await mkdir(resources, { recursive: true });
await mkdir(join(stage, "Contents/Frameworks"), { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, "src/entry.ts")],
  compile: { outfile: join(macos, "BuddyMac"), target: "bun-darwin-arm64" },
  minify: true,
});
if (!result.success) {
  for (const message of result.logs) process.stderr.write(String(message) + "\n");
  throw new Error("Bun could not compile the BuddyMac UI.");
}
for (const file of await readdir(join(dist, "native"))) {
  const source = join(dist, "native", file);
  if ((await stat(source)).isFile()) await copyFile(source, join(macos, file));
}
for (const file of ["buddymac-focus", "libbuddymac-notifications.dylib", "buddymac-default-browser"]) await copyFile(join(dist, file), join(macos, file));
await copyFile(join(root, "native/speech/build/buddymac-speech"), join(macos, "buddymac-speech"));
const focusApp = join(dist, "BuddyMac Focus.app");
const packagedFocusApp = join(stage, "Contents/Helpers/BuddyMac Focus.app");
if (existsSync(focusApp)) {
  await mkdir(join(stage, "Contents/Helpers"), { recursive: true });
  await run(["/usr/bin/ditto", focusApp, packagedFocusApp]);
}
await copyFile(join(root, "node_modules/@gpuix/native-darwin-arm64/gpuix-native.darwin-arm64.node"), join(macos, "gpuix-native.node"));
await run(["/usr/bin/strip", "-x", join(macos, "gpuix-native.node")]);
await cp(join(root, "assets/fonts"), join(resources, "fonts"), { recursive: true });
await cp(join(root, "assets/ducky"), join(resources, "ducky"), { recursive: true });
await run(["/usr/bin/ditto", join(root, "native/speech/build/Frameworks/llama.framework"), framework]);
const sourceOCU = join(root, "native/liny/ocu/Open Computer Use.app");
const packagedOCU = join(resources, "Open Computer Use.app");
await run(["/usr/bin/codesign", "--verify", "--strict", sourceOCU]);
await run(["/usr/bin/ditto", sourceOCU, packagedOCU]);
await run(["/usr/bin/codesign", "--verify", "--strict", packagedOCU]);
await mkdir(join(resources, "Licenses"), { recursive: true });
await copyFile(join(root, "node_modules/@gpuix/native/LICENSE"), join(resources, "Licenses/GPUix-LICENSE"));
await copyFile(join(root, "node_modules/react/LICENSE"), join(resources, "Licenses/React-LICENSE"));
await copyFile(join(root, "native/speech/ThirdParty/llama-LICENSE"), join(resources, "Licenses/llama-LICENSE"));
for (const file of ["SOURCE.md"]) await copyFile(join(root, "native/speech", file), join(resources, "Licenses/Speech-SOURCE.md"));
await copyFile(join(root, "native/liny/README.md"), join(resources, "Licenses/Liny-SOURCE.md"));

const icon = join(root, "assets/AppIcon.icns");
if (existsSync(icon)) await copyFile(icon, join(resources, "AppIcon.icns"));
await writeFile(join(stage, "Contents/PkgInfo"), "APPL????");
await writeFile(join(stage, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>org.buddytools.BuddyMac</string>
<key>CFBundleName</key><string>BuddyMac</string>
<key>CFBundleDisplayName</key><string>BuddyMac</string>
<key>CFBundleExecutable</key><string>BuddyMac</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleShortVersionString</key><string>0.1.6</string>
<key>CFBundleVersion</key><string>6</string>
<key>LSMinimumSystemVersion</key><string>26.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>BuddyMac records your voice when you start dictation.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>BuddyMac transcribes speech when you start dictation.</string>
<key>NSAppleEventsUsageDescription</key><string>BuddyMac controls applications when you request a desktop action.</string>
${existsSync(icon) ? "<key>CFBundleIconFile</key><string>AppIcon</string>" : ""}
</dict></plist>
`);

const sign = async (path: string, entitlementFile?: string) => {
  const args = ["/usr/bin/codesign", "--force", "--sign", identity, "--options", "runtime", "--timestamp"];
  if (entitlementFile) args.push("--entitlements", entitlementFile);
  await run([...args, path]);
};
await sign(framework);
for (const file of await readdir(macos)) {
  const permissions = file === "BuddyMac" ? entitlements : file === "buddymac-speech" ? join(root, "scripts/speech-entitlements.plist") : undefined;
  await sign(join(macos, file), permissions);
}
await sign(packagedOCU);
await sign(stage, entitlements);
await run(["/usr/bin/codesign", "--verify", "--deep", "--strict", stage]);
await run(["/usr/bin/codesign", "--verify", "--strict", packagedOCU]);
if (existsSync(packagedFocusApp)) await run(["/usr/bin/codesign", "--verify", "--strict", packagedFocusApp]);
await run([join(macos, "BuddyMac"), "--check-runtime"]);

if (existsSync(app)) {
  const previous = join(dist, "BuddyMac.previous.app");
  await rm(previous, { recursive: true, force: true });
  await rename(app, previous);
}
await rename(stage, app);
process.stdout.write(`Built and signed ${app}\n`);
