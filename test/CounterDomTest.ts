import { describe, expect, it, vi } from "vitest"
import { mount } from "../src/Index.js"
import { Counter, CounterView } from "../example/Counter"

const buttonWithText = (root: HTMLElement, text: string): HTMLButtonElement => {
  const button = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text)

  if (button === undefined) throw new Error(`no button with text ${text}`)

  return button
}

describe("Counter (DOM)", () => {
  it("renders and reacts to clicks", async () => {
    const container = document.createElement("div")
    const handle = mount(CounterView, container, Counter.layer)

    // Initial render is synchronous.
    expect(container.textContent).toContain("Count: 0")
    expect(container.textContent).toContain("Double: 0")

    buttonWithText(container, "+").click()
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Count: 1")
      expect(container.textContent).toContain("Double: 2")
    })

    buttonWithText(container, "-").click()
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Count: 0")
    })

    buttonWithText(container, "Reset").click()
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Count: 0")
      expect(container.textContent).toContain("Double: 0")
    })

    await handle.dispose()
    expect(container.textContent).toBe("")
  })
})
