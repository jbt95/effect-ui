import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const Root = fileURLToPath(new URL("../", import.meta.url))

export const sourceFingerprint = async (): Promise<string> => {
  const hash = createHash("sha256")
  const add = async (path: string): Promise<void> => {
    hash.update(relative(Root, path))
    hash.update("\0")
    hash.update(await readFile(path))
    hash.update("\0")
  }
  const visit = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )

    for (const entry of entries) {
      const path = join(directory, entry.name)

      if (entry.isDirectory()) await visit(path)
      else await add(path)
    }
  }

  for (const directory of ["../../src", "app", "shared", "scripts"]) {
    await visit(join(Root, directory))
  }

  for (const file of ["package.json", "vite.config.ts", "index.html", "tsconfig.app.json"]) {
    await add(join(Root, file))
  }

  return hash.digest("hex")
}
