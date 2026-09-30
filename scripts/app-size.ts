import { readdir, lstat } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'

const app = resolve(process.argv[2] ?? 'dist/BuddyMac.app')
const files: { path: string; bytes: number }[] = []
async function visit(directory: string): Promise<void> {
  for (const name of await readdir(directory)) {
    const path = join(directory, name)
    const stat = await lstat(path)
    if (stat.isDirectory()) await visit(path)
    else if (stat.isFile()) files.push({ path: relative(app, path), bytes: stat.size })
  }
}
await visit(app)
files.sort((a, b) => b.bytes - a.bytes)
const bytes = files.reduce((total, file) => total + file.bytes, 0)
console.log(JSON.stringify({ app, bytes, megabytes: bytes / 1_000_000, largest: files.slice(0, 15) }, null, 2))
