import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  build: {
    outDir: "demo-dist"
  },
  resolve: {
    alias: [
      { find: /^@effect\/ui\/jsx-runtime$/, replacement: here("./src/JsxRuntime.ts") },
      { find: /^@effect\/ui\/jsx-dev-runtime$/, replacement: here("./src/JsxDevRuntime.ts") },
      { find: /^@effect\/ui$/, replacement: here("./src/Index.ts") }
    ]
  },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["test/**/*Test.ts", "test/**/*Test.tsx"]
  }
})
