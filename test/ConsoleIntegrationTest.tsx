import { Effect, Layer } from "effect"
import { describe, expect, it, vi } from "vitest"
import { Application, Mount, Navigation, ResourceCache } from "../src/Index.js"
import { Activity, ConsoleView, DirectoryApi, Session } from "../example/Console.js"

type ConsoleServices = Session | DirectoryApi | Activity | ResourceCache.Cache | Navigation.Service

const Layers = (initial: string) =>
  Layer.mergeAll(
    Session.layer,
    DirectoryApi.layer,
    Activity.layer,
    ResourceCache.layer,
    Navigation.memoryLayer(initial)
  )

const StartConsole = (initial: string, container?: HTMLElement) => {
  const app = Application.make<ConsoleServices>()(
    Effect.gen(function* () {
      const View = yield* ConsoleView

      return <View />
    })
  )

  return Mount.start(app, container ?? document.createElement("div"), Layers(initial))
}

const ClickAnchor = (container: HTMLElement, href: string): void => {
  const anchor = container.querySelector(`a[href="${href}"]`)

  if (!(anchor instanceof HTMLAnchorElement)) throw new Error(`Console link to ${href} is missing`)

  anchor.click()
}

const TypeInto = (container: HTMLElement, selector: string, value: string): void => {
  const input = container.querySelector(selector)

  if (!(input instanceof HTMLInputElement)) throw new Error(`Console input ${selector} is missing`)

  input.value = value
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }))
}

describe("Console integration", () => {
  it("browses overview, searches members, and toggles on-call with activity", async () => {
    const running = await StartConsole("/console")

    try {
      await vi.waitFor(() => expect(running.container.textContent).toContain("12 members"))
      expect(running.container.textContent).toContain("3 on call")

      ClickAnchor(running.container, "/console/users")
      await vi.waitFor(() =>
        expect(running.container.querySelector("#console-member-search")).not.toBeNull()
      )

      TypeInto(running.container, "#console-member-search", "grace")
      await vi.waitFor(() => {
        const items = Array.from(
          running.container.querySelectorAll("section ul li"),
          (li) => li.textContent ?? ""
        )

        expect(items).toHaveLength(1)
        expect(items[0]).toContain("Grace Hopper")
      })

      ClickAnchor(running.container, "/console/users/grace")
      await vi.waitFor(() => expect(running.container.textContent).toContain("Team: Core"))
      expect(running.container.textContent).toContain("Off duty")

      running.container.querySelector("button")!.click()
      await vi.waitFor(() => expect(running.container.textContent).toContain("On call"))
      await vi.waitFor(() =>
        expect(running.container.textContent).toContain("Member grace on-call enabled")
      )

      ClickAnchor(running.container, "/console/users")
      await vi.waitFor(() =>
        expect(running.container.querySelector("#console-member-search")).not.toBeNull()
      )
    } finally {
      await running.dispose()
    }

    expect(running.container.childNodes).toHaveLength(0)
  })

  it("validates settings and renames the session before returning overview", async () => {
    const running = await StartConsole("/console/settings")

    try {
      await vi.waitFor(() =>
        expect(running.container.querySelector("#console-display-name")).not.toBeNull()
      )

      TypeInto(running.container, "#console-display-name", "")
      running.container
        .querySelector("form")!
        .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
      await vi.waitFor(() =>
        expect(running.container.textContent).toContain("Enter a display name")
      )
      expect(running.container.textContent).toContain("Settings")

      TypeInto(running.container, "#console-display-name", "Grace Hopper")
      TypeInto(running.container, "#console-team", "Flight")
      running.container
        .querySelector("form")!
        .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
      await vi.waitFor(() =>
        expect(running.container.textContent).toContain("Signed in as Grace Hopper")
      )
      await vi.waitFor(() =>
        expect(running.container.textContent).toContain("Profile updated to Grace Hopper (Flight)")
      )
    } finally {
      await running.dispose()
    }
  })

  it("reports unknown members and console-level not-found routes", async () => {
    const missing = await StartConsole("/console/users/nope")

    try {
      await vi.waitFor(() => expect(missing.container.textContent).toContain("Unknown member"))
    } finally {
      await missing.dispose()
    }

    const lost = await StartConsole("/console/nope")

    try {
      await vi.waitFor(() => expect(lost.container.textContent).toContain("Console page not found"))
    } finally {
      await lost.dispose()
    }
  })
})
