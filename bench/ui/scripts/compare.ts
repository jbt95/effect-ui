import { readFile } from "node:fs/promises"
import { compareReports, type Report } from "../shared/compare-report.js"

const loadReport = async (path: string): Promise<Report> => {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"))

  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as Report).keyed)) {
    throw new Error(`Not a benchmark report: ${path}`)
  }

  return parsed as Report
}

const basePath = process.argv[2]
const nextPath = process.argv[3]

if (basePath === undefined || nextPath === undefined) {
  throw new Error("Usage: bun run scripts/compare.ts <baseline.json> <candidate.json>")
}

const base = await loadReport(basePath)
const next = await loadReport(nextPath)
console.log(`base: ${base.generatedAt} (${base.sourceHash.slice(0, 12)})`)
console.log(`next: ${next.generatedAt} (${next.sourceHash.slice(0, 12)})`)
console.log("")
console.log("| case | base median | next median | Δ |")
console.log("| --- | ---: | ---: | ---: |")

for (const row of compareReports(base, next)) {
  const higherIsBetter = row.key.startsWith("throughput")
  const improved = higherIsBetter ? row.deltaPct >= 5 : row.deltaPct <= -5
  const regressed = higherIsBetter ? row.deltaPct <= -5 : row.deltaPct >= 5
  const arrow = improved ? "✓" : regressed ? "✗" : "="
  console.log(
    `| ${row.key} | ${row.baseMedian.toFixed(2)} | ${row.nextMedian.toFixed(2)} | ${arrow} ${row.deltaPct >= 0 ? "+" : ""}${row.deltaPct.toFixed(1)}% |`
  )
}

console.log("")
console.log("✓ ≥5% better, ✗ ≥5% worse, = within noise. Higher is better for throughput only.")
