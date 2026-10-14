import { describe, expect, it, vi } from "vitest"
import { Effect } from "effect"
import { noop, type Disposer, type Host } from "../src/Control.js"
import { renderNode } from "../src/runtime/Renderer.js"
import { Signal } from "../src/Signal.js"

const testHost = () => {
  const fork = vi.fn((effect: Effect.Effect<unknown, unknown, never>): Disposer => {
    void Effect.runPromise(effect)

    return noop
  })

  const host: Host = {
    renderNode: (node, parent, anchor) => renderNode(node, parent, host, anchor),
    renderNodeWithHost: (node, parent, rendererHost, anchor) =>
      renderNode(node, parent, rendererHost, anchor),
    fork,
    runHandler: () => noop,
    reportError: (cause) => {
      throw cause
    },
    trackCleanup: (cleanup) => {
      void cleanup.catch(host.reportError)
    },
    createScope: () => {
      // SAFETY: static render tests never mount components, so the scope is
      // unused and only satisfies the Host contract.
      return {} as never
    },
    closeScope: () => Promise.resolve(),
    runComponent: () => {
      throw new Error("no components in static render tests")
    },
    queueMount: () => {},
    flushMounts: () => {}
  }

  return { host, fork }
}

describe("static subtree fast path", () => {
  it("establishes multiple selection before inserting selected options", () => {
    const { host } = testHost()
    const parent = document.createElement("div")

    renderNode(
      <select multiple>
        <option selected>A</option>
        <option selected>B</option>
      </select>,
      parent,
      host
    )

    expect(Array.from(parent.querySelectorAll("option"), (Option) => Option.selected)).toEqual([
      true,
      true
    ])
  })

  it("applies scalar select values after the options have been created", () => {
    const { host } = testHost()
    const parent = document.createElement("div")

    const disposer = renderNode(
      <select value="b">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>,
      parent,
      host
    )

    expect(disposer).toBe(noop)
    expect(parent.querySelector("select")?.value).toBe("b")
    expect(parent.querySelector("select")?.selectedIndex).toBe(1)
  })

  it("renders benchmark-like rows with noop disposers and identical DOM", () => {
    const { host, fork } = testHost()
    const parent = document.createElement("tbody")

    const row = (
      <tr data-row-id={501}>
        <td>{501}</td>
        <td>{"Row 501"}</td>
        <td>{"Value 501"}</td>
      </tr>
    )

    const disposer = renderNode(row, parent, host, null)

    expect(disposer).toBe(noop)
    expect(fork).not.toHaveBeenCalled()
    expect(parent.innerHTML).toBe(
      `<tr data-row-id="501"><td>501</td><td>Row 501</td><td>Value 501</td></tr>`
    )
  })

  it("renders static fragments and nested arrays without watchers", () => {
    const { host, fork } = testHost()
    const parent = document.createElement("div")

    const disposer = renderNode(
      <>
        <span class="a">{"x"}</span>
        {["y", null, false, 42]}
      </>,
      parent,
      host,
      null
    )

    expect(disposer).toBe(noop)
    expect(fork).not.toHaveBeenCalled()
    expect(parent.innerHTML).toBe(`<span class="a">x</span>y42`)
  })

  it("falls back to reactive bindings for signal text", async () => {
    const { host } = testHost()
    const label = Effect.runSync(Signal.make("one"))
    const parent = document.createElement("td")

    const disposer = renderNode(<td>{label}</td>, parent, host, null)
    expect(disposer).not.toBe(noop)
    expect(parent.textContent).toBe("one")

    await Effect.runPromise(label.set("two"))
    await vi.waitFor(() => {
      expect(parent.textContent).toBe("two")
    })

    await disposer()
  })

  it("keeps event listener cleanup on the dynamic path", async () => {
    const { host } = testHost()
    const parent = document.createElement("div")
    let calls = 0

    const disposer = renderNode(
      <button
        onClick={() => {
          calls += 1
        }}
      >
        {"go"}
      </button>,
      parent,
      host,
      null
    )

    expect(disposer).not.toBe(noop)

    parent.querySelector("button")!.click()
    expect(calls).toBe(1)

    await disposer()
    parent.querySelector("button")!.click()
    expect(calls).toBe(1)
  })

  it("keeps ref cleanup on the dynamic path", async () => {
    const { host } = testHost()
    const parent = document.createElement("div")
    const ref = { current: null } satisfies { current: HTMLSpanElement | null }

    const disposer = renderNode(<span ref={ref}>{"x"}</span>, parent, host, null)
    expect(disposer).not.toBe(noop)
    expect(ref.current).toBe(parent.querySelector("span"))

    await disposer()
    expect(ref.current).toBeNull()
  })
})
