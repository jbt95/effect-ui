import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const Root = fileURLToPath(new URL("../", import.meta.url))

const run = (command: ReadonlyArray<string>): void => {
  console.log(`$ ${command.join(" ")}`)
  const result = spawnSync(command[0], command.slice(1), { cwd: Root, stdio: "inherit" })

  if (result.status !== 0)
    throw new Error(`Command failed (${result.status}): ${command.join(" ")}`)
}

run([process.execPath, "run", "typecheck:scripts"])
run([process.execPath, "run", "typecheck:app"])
run(["bun", "run", "vite", "build", "--config", "vite.config.ts"])
run(["bun", "run", "scripts/bundle-meta.ts"])
console.log("Built @effect/ui benchmark app")
