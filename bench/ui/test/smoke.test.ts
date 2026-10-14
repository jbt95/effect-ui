import { afterAll, beforeAll, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { domChecksum, makeRows, matchesRows, rowsChecksum } from "../shared/workloads.js"
import type { UiBenchApi } from "../shared/bench-api.js"

let browser: Window
let bench: UiBenchApi

beforeAll(async () => {
  browser = new Window()
  Object.assign(globalThis, {
    window: browser,
    document: browser.document,
    location: browser.location,
    MutationObserver: browser.MutationObserver,
    HTMLElement: browser.HTMLElement,
    Node: browser.Node,
    Event: browser.Event
  })
  document.body.innerHTML = `<div id="app"></div>`
  await import("../app/Main.js")
  await browser.happyDOM.waitUntilComplete()

  if (!window.__uiBenchReady || !window.__uiBench) {
    throw new Error(`Benchmark app did not start: ${window.__uiBenchError ?? "unknown"}`)
  }

  bench = window.__uiBench
})

afterAll(async () => {
  await browser.happyDOM.close()
})

test("keyed operations reconcile to verified DOM", async () => {
  for (const operation of ["create", "append", "update", "swap", "delete", "clear"] as const) {
    await bench.resetKeyed(operation)
    const sample = await bench.runKeyed(operation)
    expect(sample.rowCount).toBe(document.querySelectorAll("tr[data-row-id]").length)
  }

  const body = document.getElementById("bench-rows")!
  expect(matchesRows(body, makeRows(0))).toBe(true)
  expect(domChecksum(body)).toBe(rowsChecksum([]))
}, 60_000)

test("static mount/dispose and signal bindings work", async () => {
  const mounted = await bench.mountStatic()
  expect(mounted.rowCount).toBe(1000)
  expect(document.querySelectorAll("#bench-static tr[data-row-id]")).toHaveLength(1000)

  const disposed = await bench.disposeStatic()
  expect(disposed.disposeMs).toBeGreaterThanOrEqual(0)
  expect(document.querySelectorAll("#bench-static tr[data-row-id]")).toHaveLength(0)

  await bench.prepareSignals()
  const signals = await bench.runSignals()
  expect(signals.bindings).toBe(1000)

  await bench.prepareThroughput()
  const throughput = await bench.throughput(50)
  expect(throughput.completedOperations).toBeGreaterThan(0)
}, 60_000)
