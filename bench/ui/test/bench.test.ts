import { expect, test } from "bun:test"
import { summarize } from "../shared/stats.js"
import { compareReports, type Report } from "../shared/compare-report.js"
import {
  applyKeyedOperation,
  baselineFor,
  domChecksum,
  makeRows,
  matchesRows,
  rowsChecksum
} from "../shared/workloads.js"

test("summarize handles medians, p95, ranges and variability", () => {
  expect(summarize([])).toBeNull()
  expect(summarize([4, 1, 3, 2])?.median).toBe(2.5)
  expect(summarize([4, 1, 3, 2])?.p95).toBe(4)
  expect(summarize([4, 1, 3, 2])?.mad).toBe(1)
  expect(() => summarize([Number.NaN])).toThrow("Non-finite")
})

test("workload builders are deterministic and verified by checksums", () => {
  const rows = makeRows(100)
  expect(rows).toEqual(makeRows(100))
  expect(baselineFor("create", 100)).toEqual([])
  expect(baselineFor("clear", 100)).toHaveLength(100)
  expect(applyKeyedOperation("delete", rows, 100, 10)).toHaveLength(99)
  expect(applyKeyedOperation("append", rows, 100, 10)).toHaveLength(200)
  expect(rowsChecksum(rows)).toBe(rowsChecksum(makeRows(100)))
})

test("visible DOM matching validates text, not attribute mirrors", () => {
  const root = document.createElement("tbody")
  const row = makeRows(1)[0]
  root.innerHTML = `<tr data-row-id="1"><td>1</td><td>stale</td><td>Value 1</td></tr>`
  expect(matchesRows(root, [row])).toBe(false)
  expect(domChecksum(root)).not.toBe(rowsChecksum([row]))
  root.innerHTML = `<tr data-row-id="1"><td>1</td><td>Row 1</td><td>Value 1</td></tr>`
  expect(matchesRows(root, [row])).toBe(true)
  expect(domChecksum(root)).toBe(rowsChecksum([row]))
})

test("compareReports computes per-case median deltas", () => {
  const base: Report = {
    generatedAt: "base",
    sourceHash: "a",
    keyed: [
      { rows: 100, operation: "update", elapsedMs: 1 },
      { rows: 100, operation: "update", elapsedMs: 3 }
    ],
    static: [{ rows: 100, mountMs: 10 }],
    signals: [],
    throughput: [{ rows: 100, operationsPerSecond: 50 }]
  }
  const next: Report = {
    generatedAt: "next",
    sourceHash: "b",
    keyed: [
      { rows: 100, operation: "update", elapsedMs: 0.5 },
      { rows: 100, operation: "update", elapsedMs: 1.5 }
    ],
    static: [{ rows: 100, mountMs: 12 }],
    signals: [],
    throughput: [{ rows: 100, operationsPerSecond: 50 }]
  }
  const rows = compareReports(base, next)
  const update = rows.find((row) => row.key === "keyed 100 update")!
  expect(update.baseMedian).toBe(2)
  expect(update.nextMedian).toBe(1)
  expect(update.deltaPct).toBe(-50)
  expect(rows.find((row) => row.key === "static-mount 100")!.deltaPct).toBe(20)
  expect(rows.find((row) => row.key === "throughput 100")!.deltaPct).toBe(0)
})
