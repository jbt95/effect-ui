import { describe, expect, it } from "vitest"
import { CompileRoutes, MatchRoute } from "../src/router/Matching.js"
import type { RouteDefinition } from "../src/router/Types.js"
import { Virtualizer } from "../src/Virtualizer.js"
import { KeyToken, NormalizeScrollOffset, type VirtualKey } from "../src/virtualization/Window.js"

/**
 * Seeded generative checks for pure, total library functions. A mulberry32
 * PRNG keeps runs deterministic without adding a test dependency; widen the
 * case counts rather than the seed when hunting flakes.
 */

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0

  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

const int = (rand: () => number, min: number, max: number): number =>
  min + Math.floor(rand() * (max - min + 1))

const StaticSegment = (rand: () => number): string => {
  const words = ["users", "teams", "audit", "settings", "reports", "members", "console", "v2"]

  return words[int(rand, 0, words.length - 1)]
}

const staticRoute = (path: string): RouteDefinition => ({ path, render: () => null })

describe("seeded properties", () => {
  it("keeps fixed ranges inside the collection with consistent geometry", () => {
    const rand = mulberry32(0xc0ffee)

    for (let Case = 0; Case < 300; Case += 1) {
      const count = int(rand, 0, 2000)
      const itemSize = int(rand, 1, 64)
      const viewport = int(rand, 1, 480)
      const overscan = int(rand, 0, 8)
      const offset = int(rand, -200, count * itemSize + 200)
      const range = Virtualizer.fixedRange(count, itemSize, viewport, offset, overscan)

      expect(Number.isInteger(range.start)).toBe(true)
      expect(Number.isInteger(range.end)).toBe(true)
      expect(range.start).toBeGreaterThanOrEqual(0)
      expect(range.end).toBeLessThanOrEqual(count)
      expect(range.end).toBeGreaterThanOrEqual(range.start)
      expect(range.offset).toBe(range.start * itemSize)
      expect(range.totalSize).toBe(count * itemSize)

      const safe = NormalizeScrollOffset(offset, range.totalSize, viewport)
      const visibleStart = Math.min(count, Math.floor(safe / itemSize))
      const visibleEnd = Math.min(count, Math.ceil((safe + viewport) / itemSize))
      expect(range.start).toBeLessThanOrEqual(visibleStart)
      expect(range.end).toBeGreaterThanOrEqual(visibleEnd)
      expect(range.start).toBeGreaterThanOrEqual(visibleStart - overscan)
      expect(range.end).toBeLessThanOrEqual(visibleEnd + overscan)

      const wider = Virtualizer.fixedRange(count, itemSize, viewport, offset, overscan + 2)
      expect(wider.end - wider.start).toBeGreaterThanOrEqual(range.end - range.start)
    }
  })

  it("assigns distinct stable tokens to distinct virtual keys", () => {
    const rand = mulberry32(0xdec0de)

    const pool: ReadonlyArray<VirtualKey> = [
      "",
      "-",
      "%",
      "%2D",
      "a/b",
      "person-0",
      "héllo",
      "日本語",
      "x".repeat(64),
      0,
      1,
      -1,
      2.5,
      1e21,
      Number.MAX_SAFE_INTEGER
    ]

    for (let Case = 0; Case < 200; Case += 1) {
      const size = int(rand, 1, 12)
      const keys: Array<VirtualKey> = []

      while (keys.length < size) {
        const candidate = pool[int(rand, 0, pool.length - 1)]

        if (!keys.includes(candidate)) keys.push(candidate)
      }

      const tokens = keys.map((key) => KeyToken(key))
      expect(new Set(tokens).size).toBe(keys.length)

      for (const [index, key] of keys.entries()) {
        expect(KeyToken(key)).toBe(tokens[index])
      }
    }
  })

  it("matches static routes regardless of redundant slashes", () => {
    const rand = mulberry32(0xb16b00b5)

    for (let Case = 0; Case < 100; Case += 1) {
      const depth = int(rand, 1, 3)
      const segments = Array.from({ length: depth }, () => StaticSegment(rand))
      const path = `/${segments.join("/")}`
      const compiled = CompileRoutes([staticRoute(path)])

      for (const variant of [path, `${path}/`, path.replaceAll("/", "//")]) {
        expect(MatchRoute(compiled.Matches, variant)?.Route.path).toBe(path)
      }

      expect(MatchRoute(compiled.Matches, `${path}/unrelated`)).toBeUndefined()
    }
  })

  it("captures encoded parameters and respects route order", () => {
    const param = (path: string): RouteDefinition => ({
      path,
      render: ({ params }) => params.id ?? params.a ?? null
    })

    const ids = ["ada", "bob-2", "x.y_z", "a b", "héllo", "100%"]
    const compiled = CompileRoutes([param("/users/:id"), param("/files/:a/:b")])

    for (const id of ids) {
      const match = MatchRoute(compiled.Matches, `/users/${encodeURIComponent(id)}`)
      expect(match?.Params.id).toBe(id)
    }

    const pair = MatchRoute(compiled.Matches, "/files/a/b")
    expect(pair?.Params).toEqual({ a: "a", b: "b" })

    const staticFirst = CompileRoutes([staticRoute("/a/b"), param("/a/:id")])
    expect(MatchRoute(staticFirst.Matches, "/a/b")?.Route.path).toBe("/a/b")

    const paramFirst = CompileRoutes([param("/a/:id"), staticRoute("/a/b")])
    const shadowed = MatchRoute(paramFirst.Matches, "/a/b")
    expect(shadowed?.Route.path).toBe("/a/:id")
    expect(shadowed?.Params.id).toBe("b")
  })
})
