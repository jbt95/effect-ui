import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { Signal } from "../src/Signal.js"
import { cleanup, fireInput, render, waitFor } from "../src/TestingLegacy.js"

afterEach(async () => cleanup())

describe("public testing utilities", () => {
  it("mounts a JSX subtree, dispatches native input, waits for updates, and cleans up", async () => {
    const value = Effect.runSync(Signal.make("initial"))

    const view = render(
      <section>
        <label htmlFor="query">Query</label>
        <input id="query" value={value} onInput={(event) => value.set(event.currentTarget.value)} />
        <p>{value}</p>
      </section>
    )

    expect(view.getByText("Query").textContent).toBe("Query")
    fireInput(view.container.querySelector("input")!, "updated")
    await waitFor(() => expect(view.getByText("updated").textContent).toBe("updated"))

    await view.unmount()
    expect(view.container.textContent).toBe("")
  })

  it("preserves pre-existing container content when the view is disposed", async () => {
    const container = document.createElement("div")
    const existing = document.createElement("span")
    existing.textContent = "keep me"
    container.append(existing)

    const view = render(<p>temporary</p>, { container })

    expect(view.getByText("temporary").textContent).toBe("temporary")
    await cleanup()
    expect(container.textContent).toBe("keep me")
  })
})
