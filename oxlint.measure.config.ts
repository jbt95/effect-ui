import { defineConfig } from "oxlint"

export default defineConfig({
  jsPlugins: [
    {
      name: "better-antislop",
      specifier: "/Users/Jordi/git/effect-ui/tools/oxlint/better-antislop/src/Index.ts"
    }
  ],
  rules: {
    "better-antislop/cognitive-complexity": ["error", { limit: 15 }],
    "better-antislop/max-nesting-depth": ["error", { limit: 4 }],
    "better-antislop/min-maintainability-index": ["error", { limit: 50 }],
    "better-antislop/no-chained-type-assertions": "error",
    "better-antislop/no-array-filter-map": "error",
    "better-antislop/no-reduce-accumulator-copy": "error",
    "better-antislop/no-conditional-empty-object-spread": "error",
    "better-antislop/no-known-value-widening": "error",
    "better-antislop/no-module-mocking": "error",
    "better-antislop/no-object-parameters": "error",
    "better-antislop/no-reflect-apply": "error",
    "better-antislop/no-reflect-get": "error",
    "better-antislop/no-runtime-typeof": ["error", { allowInTypeGuards: true }],
    "better-antislop/no-unknown-parameters": "error",
    "better-antislop/no-unknown-returns": "error",
    "better-antislop/no-unknown-type-aliases": "error",
    "better-antislop/no-unsafe-dictionary-type": "error",
    "better-antislop/no-shape-in-symbol-names": "error",
    "better-antislop/no-widen-then-assert": "error",
    "better-antislop/require-readable-spacing": "error",
    "better-antislop/require-safety-comment-for-type-assertion": "error",
    "better-antislop/no-manual-effect-error-tag": "error",
    "better-antislop/no-manual-tag-comparison": "error",
    "better-antislop/no-manual-tagged-construction": "error",
    "better-antislop/no-service-constructor-imports": "error",
    "better-antislop/prefer-effect-match": "error",
    "eslint/no-control-regex": "warn"
  }
})
