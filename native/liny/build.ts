import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = resolve(import.meta.dir, '../..')
await mkdir(resolve(root, 'dist'), { recursive: true })
const browser = Bun.spawn(['swiftc', '-O', '-module-cache-path', '/private/tmp/buddymac-swift-module-cache', resolve(import.meta.dir, 'DefaultBrowser.swift'), '-o', resolve(root, 'dist/buddymac-default-browser')], { stdout: 'inherit', stderr: 'inherit' })
if (await browser.exited !== 0) throw new Error('Default browser metadata helper build failed')
const child = Bun.spawn([process.execPath, 'build', resolve(import.meta.dir, 'worker.ts'), '--compile', '--outfile', resolve(root, 'dist/buddymac-liny')], { cwd: root, stdout: 'inherit', stderr: 'inherit' })
if (await child.exited !== 0) throw new Error('Liny service build failed')
