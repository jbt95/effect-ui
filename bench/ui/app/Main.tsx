import { Effect, Layer } from "effect"
import { defineComponent, For, mount, onMount, Signal } from "@effect/ui"
import type { KeyedOperation, Row } from "../shared/workloads.js"
import type { KeyedSample, ThroughputSample, UiBenchApi } from "../shared/bench-api.js"
import {
  applyKeyedOperation,
  baselineFor,
  domChecksum,
  makeRows,
  matchesRows,
  rowCount,
  rowsChecksum,
  updateEvery
} from "../shared/workloads.js"
import { waitForCount, waitForDom } from "../shared/verify.js"

const TotalRows = rowCount()
const Every = updateEvery()

const rowElement = (value: Row) => (
  <tr data-row-id={value.id}>
    <td>{value.id}</td>
    <td>{value.label}</td>
    <td>{value.value}</td>
  </tr>
)

export const App = defineComponent(() =>
  Effect.gen(function* () {
    const Rows = yield* Signal.make<ReadonlyArray<Row>>(makeRows(TotalRows))
    const Revision = yield* Signal.make(0)

    let currentRows: ReadonlyArray<Row> = makeRows(TotalRows)
    let revision = 0
    let busy = false
    let cyclePair: readonly [ReadonlyArray<Row>, ReadonlyArray<Row>] | undefined
    let cycleIndex = 0
    let staticDisposer: (() => Promise<void>) | undefined
    let signalCells: ReadonlyArray<Signal<number>> = []
    let signalDisposer: (() => Promise<void>) | undefined
    let signalExpected: ReadonlyArray<number> = []

    const bodyOf = (): HTMLElement => {
      const body = document.getElementById("bench-rows")

      if (!(body instanceof HTMLElement)) throw new Error("Benchmark table body is missing")

      return body
    }

    const exclusive = async <A,>(run: () => Promise<A>): Promise<A> => {
      if (busy) throw new Error("Benchmark operations must run sequentially")
      busy = true

      try {
        return await run()
      } finally {
        busy = false
      }
    }

    const commitKeyed = async (nextRows: ReadonlyArray<Row>) => {
      const body = bodyOf()
      const nextRevision = revision + 1
      const waiter = waitForDom(body, nextRows, nextRevision)
      const startedAt = performance.now()

      try {
        Effect.runSync(Rows.set(nextRows))
        Effect.runSync(Revision.set(nextRevision))
      } catch (cause) {
        waiter.cancel(new Error(String(cause)))
      }

      const completion = await waiter.done
      currentRows = nextRows
      revision = nextRevision

      return {
        elapsedMs: Math.max(0, completion.observedAt - startedAt),
        readinessChecks: completion.readinessChecks
      }
    }

    const runKeyedOperation = async (operation: KeyedOperation): Promise<KeyedSample> => {
      const nextRows = applyKeyedOperation(operation, currentRows, TotalRows, Every)
      const completion = await commitKeyed(nextRows)
      const body = bodyOf()
      const checksum = domChecksum(body)

      if (checksum !== rowsChecksum(nextRows)) {
        throw new Error(`${operation} visible DOM checksum mismatch`)
      }

      return { operation, ...completion, rowCount: nextRows.length, checksum }
    }

    const StaticTable = defineComponent(({ rows }: { readonly rows: ReadonlyArray<Row> }) =>
      Effect.succeed(
        <table>
          <tbody>
            {rows.map((row) => (
              <tr data-row-id={row.id}>
                <td>{row.id}</td>
                <td>{row.label}</td>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    )

    const SignalTable = defineComponent(
      ({ cells }: { readonly cells: ReadonlyArray<Signal<number>> }) =>
        Effect.succeed(
          <div>
            {cells.map((cell) => (
              <span>{cell}</span>
            ))}
          </div>
        )
    )

    const api: UiBenchApi = {
      resetKeyed: (operation) =>
        exclusive(async () => {
          await commitKeyed(baselineFor(operation, TotalRows))
        }),
      runKeyed: (operation) => exclusive(() => runKeyedOperation(operation)),
      mountStatic: () =>
        exclusive(async () => {
          const host = document.getElementById("bench-static")

          if (!(host instanceof HTMLElement)) throw new Error("Static host is missing")
          if (staticDisposer !== undefined) throw new Error("Static tree already mounted")

          host.replaceChildren()
          const rows = makeRows(TotalRows)
          const startedAt = performance.now()
          const handle = mount(
            defineComponent(() => Effect.succeed(<StaticTable rows={rows} />)),
            host,
            Layer.empty
          )
          staticDisposer = () => handle.dispose()
          await waitForCount(host, "tr[data-row-id]", rows.length)

          return { mountMs: performance.now() - startedAt, rowCount: rows.length }
        }),
      disposeStatic: () =>
        exclusive(async () => {
          const host = document.getElementById("bench-static")

          if (!(host instanceof HTMLElement)) throw new Error("Static host is missing")
          if (staticDisposer === undefined) throw new Error("No static tree mounted")

          const dispose = staticDisposer
          staticDisposer = undefined
          const startedAt = performance.now()
          await dispose()
          await waitForCount(host, "tr[data-row-id]", 0)

          return { disposeMs: performance.now() - startedAt }
        }),
      prepareSignals: () =>
        exclusive(async () => {
          const host = document.getElementById("bench-signals")

          if (!(host instanceof HTMLElement)) throw new Error("Signal host is missing")

          if (signalDisposer !== undefined) {
            await signalDisposer()
            signalDisposer = undefined
          }

          host.replaceChildren()
          signalCells = makeRows(TotalRows).map((row) => Effect.runSync(Signal.make(row.id)))
          signalExpected = signalCells.map((cell) => cell.value)
          const handle = mount(
            defineComponent(() => Effect.succeed(<SignalTable cells={signalCells} />)),
            host,
            Layer.empty
          )
          signalDisposer = () => handle.dispose()
          await waitForCount(host, "span", signalCells.length)
        }),
      runSignals: () =>
        exclusive(async () => {
          const host = document.getElementById("bench-signals")

          if (!(host instanceof HTMLElement)) throw new Error("Signal host is missing")

          signalExpected = signalExpected.map((value) => value + 1)
          const expected = signalExpected
          const startedAt = performance.now()

          for (let index = 0; index < signalCells.length; index += 1) {
            Effect.runSync(signalCells[index].set(expected[index]))
          }

          const deadline = startedAt + 30_000

          while (performance.now() < deadline) {
            const spans = host.querySelectorAll("span")
            let done = spans.length === expected.length

            for (let index = 0; done && index < expected.length; index += 1) {
              if (spans[index].textContent !== String(expected[index])) done = false
            }

            if (done) return { elapsedMs: performance.now() - startedAt, bindings: expected.length }

            await new Promise<void>((resolve) => setTimeout(resolve, 0))
          }

          throw new Error("Timed out waiting for signal bindings")
        }),
      prepareThroughput: () =>
        exclusive(async () => {
          const base = baselineFor("update", TotalRows)
          cyclePair = [base, applyKeyedOperation("update", base, TotalRows, Every)]
          cycleIndex = 0
          await commitKeyed(base)
        }),
      throughput: (durationMs) =>
        exclusive(async () => {
          if (cyclePair === undefined) throw new Error("Call prepareThroughput first")
          if (!Number.isFinite(durationMs) || durationMs <= 0) {
            throw new Error("duration must be positive")
          }

          const pair = cyclePair
          const start = performance.now()
          let count = 0

          while (performance.now() - start < durationMs) {
            cycleIndex = 1 - cycleIndex
            await commitKeyed(pair[cycleIndex])
            count += 1
          }

          const elapsedMs = performance.now() - start

          return {
            completedOperations: count,
            elapsedMs,
            operationsPerSecond: (count * 1_000) / elapsedMs
          }
        })
    }

    yield* onMount(() => {
      const body = bodyOf()

      if (body.querySelectorAll("tr[data-row-id]").length !== TotalRows) {
        throw new Error(`Expected ${TotalRows} initial rows`)
      }

      performance.mark("bench:dom-ready")
      // The start mark lives in index.html; unit harnesses mount without it.
      let bootMs = 0

      try {
        bootMs = performance.measure("bench:mount", "bench:html-start", "bench:dom-ready").duration
      } catch {
        bootMs = 0
      }

      window.__uiBench = api
      window.__uiBenchBootMs = bootMs
      window.__uiBenchReady = true
    })

    return (
      <main>
        <h1>@effect/ui benchmark</h1>
        <div className="bench-layout">
          <table>
            <thead>
              <tr>
                <th>Id</th>
                <th>Label</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody id="bench-rows" data-revision={Revision}>
              <For each={Rows} keyOf={(value: Row) => value.id}>
                {rowElement}
              </For>
            </tbody>
          </table>
        </div>
        <section id="bench-static"></section>
        <section id="bench-signals"></section>
      </main>
    )
  })
)

const container = document.getElementById("app")

if (!(container instanceof HTMLElement)) throw new Error("Benchmark container is missing")

mount(App, container, Layer.empty)
