import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const executableDirectory = dirname(process.execPath);
const packaged = executableDirectory.endsWith(".app/Contents/MacOS");
if (packaged) {
  const resources = join(executableDirectory, "../Resources");
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = join(executableDirectory, "gpuix-native.node");
  process.env.BUDDYMAC_NATIVE_DIR ??= executableDirectory;
  const focusApp = join(executableDirectory, "../Helpers/BuddyMac Focus.app/Contents/MacOS/buddymac-focus");
  process.env.BUDDYMAC_FOCUS_HELPER ??= existsSync(focusApp) ? focusApp : join(executableDirectory, "buddymac-focus");
  process.env.BUDDYMAC_SPEECH_BINARY ??= join(executableDirectory, "buddymac-speech");
  process.env.BUDDYMAC_LINY_HELPER ??= join(executableDirectory, "buddymac-liny");
  if (process.argv.includes("--check-permissions")) {
    const {SpeechClient} = await import("./speech");
    const {focusNotificationStatus} = await import("./focus");
    const client = new SpeechClient();
    try {
      const speech = await client.status();
      const notifications = await focusNotificationStatus();
      process.stdout.write(JSON.stringify({microphone: speech.microphoneGranted, accessibility: speech.accessibilityGranted, screenCapture: speech.screenCaptureGranted, keyConfigured: speech.keyConfigured, notifications}) + "\n");
    } finally { client.dispose(); }
    process.exit(0);
  } else if (process.argv.includes("--check-runtime")) {
    const paths = ["gpuix-native.node", "libbuddymac.dylib", "libbuddymac-edge.dylib", "libbuddymac-panel.dylib", "buddymac-files", "buddymac-dock-applier", "buddymac-dock-inspector", "buddymac-focus", "libbuddymac-notifications.dylib", "buddymac-speech", "buddymac-liny", "buddymac-default-browser"];
    for (const path of paths) if (!existsSync(join(executableDirectory, path))) throw new Error(`Missing bundled runtime: ${path}`);
    for (const path of ["fonts/ChakraPetch-Bold.ttf", "fonts/IBMPlexMono-Regular.ttf", "ducky/frame-00.png", "Open Computer Use.app/Contents/MacOS/OpenComputerUse"]) {
      if (!existsSync(join(resources, path))) throw new Error(`Missing bundled resource: ${path}`);
    }
    const native = await import("@gpuix/native");
    await import("./platform");
    if (typeof native.GpuixRenderer !== "function") throw new Error("The bundled GPUix native renderer did not load.");
    process.stdout.write(JSON.stringify({ runtime: "bundled", gpuixNativeLoaded: true, helpers: paths.length, openedWindow: false }) + "\n");
  } else await import("./app");
} else await import("./app");
