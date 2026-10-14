import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { arch, cpus, platform, release, totalmem } from "node:os"
import { fileURLToPath } from "node:url"
import { chromium, type Browser, type Page } from "playwright"
import type { KeyedOperation } from "../shared/workloads.js"
import type { KeyedSample, ThroughputSample } from "../shared/bench-api.js"
import { KeyedOperations } from "../shared/workloads.js"
import { summarize } from "../shared/stats.js"
import { sourceFingerprint } from "./fingerprint.js"

const Root = fileURLToPath(new URL("../", import.meta.url))
const BaseUrl = (process.env.BENCH_BASE_URL ?? "http://127.0.0.1:4173").replace(/\/$/, "")
const ResultsRoot = process.env.BENCH_RESULTS_DIR ?? join(Root, "results")
const Seed = Number(process.env.BENCH_SEED ?? 12345) >>> 0
const Runs = positiveInteger("BENCH_RUNS", 12)
const Rounds = positiveInteger("BENCH_ROUNDS", 2)
const Warmups = positiveInteger("BENCH_WARMUPS", 3)
const BootRuns = positiveInteger("BENCH_BOOT_RUNS", 2)
const DurationMs = positiveInteger("BENCH_DURATION_MS", 1000)
const StaticReps = positiveInteger("BENCH_STATIC_REPS", 3)
const Scales = (process.env.BENCH_ROWS ?? "100,1000,10000").split(",").map(Number)

if (Scales.some((rows) => !Number.isInteger(rows) || rows < 2 || rows > 100_000)) {
  throw new Error("BENCH_ROWS must be comma-separated integers between 2 and 100000")
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)

  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)

  return value
}

const shuffle = <A>(values: ReadonlyArray<A>, seed: number): Array<A> => {
  let state = seed >>> 0 || 0x9e3779b9
  const result = values.slice()

  for (let index = result.length - 1; index > 0; index -= 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    const other = Math.floor(((state >>> 0) / 4_294_967_296) * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }

  return result
}

interface KeyedSampleRecord extends KeyedSample {
  readonly rows: number
  readonly round: number
}

interface StaticSample {
  readonly rows: number
  readonly round: number
  readonly mountMs: number
  readonly disposeMs: number
}

interface SignalSampleRecord {
  readonly rows: number
  readonly elapsedMs: number
  readonly bindings: number
}

interface ThroughputRecord extends ThroughputSample {
  readonly rows: number
  readonly round: number
}

const KeyedSamples: Array<KeyedSampleRecord> = []
const StaticSamples: Array<StaticSample> = []
const SignalSamples: Array<SignalSampleRecord> = []
const ThroughputSamples: Array<ThroughputRecord> = []
const MountSamples: Array<number> = []
const ScaleOrders: Array<ReadonlyArray<number>> = []

const navigate = async (page: Page, rows: number): Promise<number> => {
  await page.goto(`${BaseUrl}/?rows=${rows}`, { waitUntil: "load" })
  await page.waitForFunction(() => window.__uiBenchReady || window.__uiBenchError)

  return page.evaluate(() => {
    if (window.__uiBenchError) throw new Error(window.__uiBenchError)

    return window.__uiBenchBootMs!
  })
}

let browser: Browser | undefined

try {
  const sourceHash = await sourceFingerprint()
  const meta = JSON.parse(await readFile(join(Root, "dist/meta.json"), "utf8")) as {
    sourceHash: string
  }

  if (meta.sourceHash !== sourceHash) {
    throw new Error("Sources changed since build; run bun run build again")
  }

  browser = await chromium.launch({
    headless: process.env.BENCH_HEADED !== "1",
    executablePath: process.env.BENCH_EXECUTABLE_PATH,
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"]
  })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1
  })
  const page = await context.newPage()
  page.setDefaultTimeout(60_000)
  await navigate(page, 1000)
  const environment = {
    host: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem()
    },
    browser: await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      visibility: document.visibilityState
    })),
    headless: process.env.BENCH_HEADED !== "1"
  }

  for (let boot = -1; boot < BootRuns; boot += 1) {
    for (const rows of shuffle(Scales, Seed + boot)) {
      const duration = await navigate(page, rows)

      if (boot >= 0) MountSamples.push(duration)
    }
  }

  for (let round = 0; round < Rounds; round += 1) {
    const order = shuffle(Scales, Seed + round * 101)
    ScaleOrders.push(order)

    for (const rows of order) {
      console.log(`Round ${round + 1}/${Rounds}: ${rows} rows`)
      await navigate(page, rows)

      for (const operation of shuffle(KeyedOperations, Seed + round * 31)) {
        for (let index = 0; index < Warmups + Runs; index += 1) {
          const value = await page.evaluate(async (input: KeyedOperation) => {
            const api = window.__uiBench!
            await api.resetKeyed(input)

            return api.runKeyed(input)
          }, operation)

          if (index >= Warmups) KeyedSamples.push({ ...value, rows, round })
        }
      }

      for (let rep = 0; rep < StaticReps; rep += 1) {
        const mounted = await page.evaluate(async () => window.__uiBench!.mountStatic())
        const disposed = await page.evaluate(async () => window.__uiBench!.disposeStatic())
        StaticSamples.push({ rows, round, mountMs: mounted.mountMs, disposeMs: disposed.disposeMs })
      }

      await page.evaluate(async () => window.__uiBench!.prepareSignals())

      for (let index = 0; index < Runs; index += 1) {
        const value = await page.evaluate(async () => window.__uiBench!.runSignals())
        SignalSamples.push({ rows, ...value })
      }

      const throughput = await page.evaluate(
        async (input: { readonly duration: number }) => {
          const api = window.__uiBench!
          await api.prepareThroughput()

          return api.throughput(input.duration)
        },
        { duration: DurationMs }
      )
      ThroughputSamples.push({ ...throughput, rows, round })
    }
  }

  const summarizeKeyed = (rows: number, operation: KeyedOperation) =>
    summarize(
      KeyedSamples.filter((sample) => sample.rows === rows && sample.operation === operation).map(
        (sample) => sample.elapsedMs
      )
    )
  const lines = [
    "# @effect/ui benchmark",
    "",
    `Seed: ${Seed}; rounds: ${Rounds}; runs: ${Runs} + ${Warmups} warmups.`,
    ""
  ]
  lines.push("## Keyed table latency (median / p95 ms)", "")

  for (const rows of Scales) {
    lines.push(`### ${rows} rows`, "")
    for (const operation of KeyedOperations) {
      const summary = summarizeKeyed(rows, operation)
      lines.push(
        `- ${operation}: ${summary?.median.toFixed(2)} / ${summary?.p95.toFixed(2)} (n=${summary?.samples})`
      )
    }
    lines.push("")
  }

  lines.push("## Static mount / dispose (median ms)", "")
  for (const rows of Scales) {
    const mount = summarize(StaticSamples.filter((s) => s.rows === rows).map((s) => s.mountMs))
    const dispose = summarize(StaticSamples.filter((s) => s.rows === rows).map((s) => s.disposeMs))
    lines.push(
      `- ${rows} rows: mount ${mount?.median.toFixed(2)} (n=${mount?.samples}), dispose ${dispose?.median.toFixed(2)} (n=${dispose?.samples})`
    )
  }
  lines.push("", "## Signal bindings (median ms for all bindings)", "")
  for (const rows of Scales) {
    const summary = summarize(SignalSamples.filter((s) => s.rows === rows).map((s) => s.elapsedMs))
    lines.push(`- ${rows} bindings: ${summary?.median.toFixed(2)}`)
  }
  lines.push("", "## Keyed throughput (median ops/s)", "")
  for (const rows of Scales) {
    const summary = summarize(
      ThroughputSamples.filter((s) => s.rows === rows).map((s) => s.operationsPerSecond)
    )
    lines.push(`- ${rows} rows: ${summary?.median.toFixed(1)}`)
  }
  lines.push(
    "",
    "Timings end at the last observed mutation of a subsequently verified visible DOM; verification and observer scheduling can perturb the workload. Not bare renderer CPU times."
  )
  const markdown = lines.join("\n")
  const result = {
    status: "measured",
    generatedAt: new Date().toISOString(),
    browserVersion: browser.version(),
    environment,
    sourceHash,
    configuration: {
      seed: Seed,
      rounds: Rounds,
      runs: Runs,
      warmups: Warmups,
      bootRuns: BootRuns,
      durationMs: DurationMs,
      staticReps: StaticReps,
      rowCounts: Scales
    },
    scaleOrders: ScaleOrders,
    keyed: KeyedSamples,
    static: StaticSamples,
    signals: SignalSamples,
    throughput: ThroughputSamples,
    mounts: MountSamples,
    mountSummary: summarize(MountSamples)
  }

  await mkdir(ResultsRoot, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")

  for (const stem of [`bench-${stamp}`, "bench-latest"]) {
    await writeFile(join(ResultsRoot, `${stem}.json`), `${JSON.stringify(result, null, 2)}\n`)
    await writeFile(join(ResultsRoot, `${stem}.md`), `${markdown}\n`)
  }

  console.log(markdown)
} catch (cause) {
  const reason = String(cause)
  await mkdir(ResultsRoot, { recursive: true })
  await writeFile(
    join(ResultsRoot, "bench-attempt-latest.json"),
    `${JSON.stringify({ status: "failed", reason }, null, 2)}\n`
  )
  throw cause
} finally {
  await browser?.close()
}
