import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

// Compiles native/platform.m with its self-test entry point. It covers the window-delegate proxy that once
// recursed forever when AppKit's Services menu asked GPUI's self-delegating window for a requestor.
test('native platform self-test passes', async () => {
  const output = '/private/tmp/buddymac-platform-selftest'
  const build = Bun.spawn(['/usr/bin/clang', '-fobjc-arc', '-DBUDDYMAC_PLATFORM_TEST_MAIN', resolve(import.meta.dir, '../native/platform.m'), '-o', output, '-framework', 'AppKit', '-framework', 'CoreText', '-framework', 'ServiceManagement', '-framework', 'Carbon', '-mmacosx-version-min=14.0'], { stdout: 'ignore', stderr: 'pipe' })
  expect(await build.exited).toBe(0)
  const run = Bun.spawn([output], { stdout: 'pipe', stderr: 'pipe' })
  const [text, code] = await Promise.all([new Response(run.stdout).text(), run.exited])
  expect(code).toBe(0)
  expect(text).toContain('self-delegating window without recursion')
}, 60_000)
