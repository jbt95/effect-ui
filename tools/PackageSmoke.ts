import { execFileSync } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import Package from "../package.json" with { type: "json" }
import ConsumerConfig from "../tsconfig.package.json" with { type: "json" }

const Root = fileURLToPath(new URL("..", import.meta.url))

const Consumer = await mkdtemp(join(tmpdir(), "effect-ui-package-"))

try {
  // CI builds first; skipping lifecycle scripts keeps this check on that exact artifact.
  execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", Consumer], {
    cwd: Root,
    stdio: "pipe"
  })

  const Archive = (await readdir(Consumer)).find((File) => File.endsWith(".tgz"))

  if (Archive === undefined) throw new Error("npm pack did not produce a tarball")

  const InstalledPackage = join(Consumer, "node_modules", "@effect", "ui")
  await mkdir(InstalledPackage, { recursive: true })
  execFileSync("tar", [
    "-xzf",
    join(Consumer, Archive),
    "--strip-components=1",
    "-C",
    InstalledPackage
  ])

  // Only external dependencies are linked. Library code and types must come from the tarball.
  await symlink(
    join(Root, "node_modules", "effect"),
    join(Consumer, "node_modules", "effect"),
    "dir"
  )
  await writeFile(join(Consumer, "package.json"), JSON.stringify({ private: true, type: "module" }))
  await copyFile(join(Root, "test", "PackageConsumer.tsx"), join(Consumer, "PackageConsumer.tsx"))
  await writeFile(
    join(Consumer, "tsconfig.json"),
    JSON.stringify({
      ...ConsumerConfig,
      compilerOptions: { ...ConsumerConfig.compilerOptions, skipLibCheck: false },
      include: ["PackageConsumer.tsx"]
    })
  )

  const Imports = Object.keys(Package.exports).map((Subpath) => {
    const Specifier = Subpath === "." ? Package.name : `${Package.name}${Subpath.slice(1)}`

    return `await import(${JSON.stringify(Specifier)});`
  })

  execFileSync("node", ["--input-type=module", "-e", Imports.join("\n")], {
    cwd: Consumer,
    stdio: "inherit"
  })
  execFileSync(join(Root, "node_modules", ".bin", "tsc"), ["-p", join(Consumer, "tsconfig.json")], {
    cwd: Consumer,
    stdio: "inherit"
  })

  console.log("Packed package passed ESM imports and strict NodeNext consumer type checks.")
} finally {
  await rm(Consumer, { recursive: true, force: true })
}
