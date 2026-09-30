import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { dirname, join } from "node:path";
import type { StdioMcpClient } from "./stdio-mcp-client.ts";

const browserSchema = Type.Object({
 name: Type.String({ minLength: 1 }),
 bundleIdentifier: Type.String({ minLength: 1 }),
 path: Type.String({ minLength: 1 }),
});

export async function resolveDefaultBrowser(client: Pick<StdioMcpClient, "callTool">, signal?: AbortSignal): Promise<Static<typeof browserSchema>> {
 const result = await client.callTool("get_default_browser", {}, signal);
 if (result.isError || !Check(browserSchema, result.structuredContent)) throw new Error("Could not resolve the macOS default browser. No substitute browser was opened.");
 return result.structuredContent;
}

export async function resolveSystemDefaultBrowser(signal?: AbortSignal): Promise<Static<typeof browserSchema>> {
 signal?.throwIfAborted();
 const executable = process.env.BUDDYMAC_DEFAULT_BROWSER_HELPER ?? join(dirname(process.execPath), "buddymac-default-browser");
 const child = Bun.spawn([executable], { stdout: "pipe", stderr: "pipe" });
 const abort = () => child.kill();
 signal?.addEventListener("abort", abort, { once: true });
 try {
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  signal?.throwIfAborted();
  if (code !== 0) throw new Error(error.trim() || "Could not read the macOS default browser.");
  const browser: unknown = JSON.parse(output);
  if (!Check(browserSchema, browser)) throw new Error("macOS returned incomplete default-browser metadata.");
  return browser;
 } finally { signal?.removeEventListener("abort", abort); }
}
