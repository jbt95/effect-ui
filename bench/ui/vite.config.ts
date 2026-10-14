import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("./dist/", import.meta.url)),
    emptyOutDir: true
  },
  resolve: {
    alias: [
      {
        find: /^@effect\/ui$/,
        replacement: fileURLToPath(new URL("../../src/Index.ts", import.meta.url))
      },
      {
        find: /^@effect\/ui\/jsx-runtime$/,
        replacement: fileURLToPath(new URL("../../src/JsxRuntime.ts", import.meta.url))
      },
      {
        find: /^@effect\/ui\/jsx-dev-runtime$/,
        replacement: fileURLToPath(new URL("../../src/JsxDevRuntime.ts", import.meta.url))
      }
    ]
  }
})
