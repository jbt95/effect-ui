import { gzipSync } from "node:zlib"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { sourceFingerprint } from "./fingerprint.js"

const Root = fileURLToPath(new URL("../", import.meta.url))

const html = await readFile(join(Root, "dist/index.html"), "utf8").catch(() => {
  throw new Error("dist/index.html is missing; run the vite build first")
})
const script = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i)?.[1]?.split(/[?#]/, 1)[0]

if (script === undefined) throw new Error("No script asset found in dist/index.html")

const content = await readFile(join(Root, "dist", script))
const report = {
  generatedAt: new Date().toISOString(),
  sourceHash: await sourceFingerprint(),
  files: [
    {
      path: "dist/index.html",
      sha256: createHash("sha256").update(html).digest("hex")
    },
    {
      path: `dist/${script}`,
      bytes: content.byteLength,
      gzipBytes: gzipSync(content, { level: 9 }).byteLength,
      sha256: createHash("sha256").update(content).digest("hex")
    }
  ]
}

await mkdir(join(Root, "dist"), { recursive: true })
await writeFile(join(Root, "dist/meta.json"), `${JSON.stringify(report, null, 2)}\n`)
console.log(`sourceHash ${report.sourceHash}`)
