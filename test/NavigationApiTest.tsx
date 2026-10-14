import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import { Application, Link, Mount, Navigation, Router } from "../src/Index.js"

describe("acquired navigation adapters", () => {
  it("preserves native popstate and hashchange hook kinds", async () => {
    const old = window.location.href
    window.history.replaceState(null, "", "/")
    const kinds: Array<Router.NavigationKind> = []

    const app = Application.make<Navigation.Service>()(
      Effect.gen(function* () {
        const Outlet = yield* Router.make({
          routes: [
            { path: "/", render: () => <p>Home</p> },
            { path: "/next", render: () => <p>Next</p> }
          ],
          onAfterNavigate: ({ kind }) => {
            kinds.push(kind)
          }
        })

        return <Outlet />
      })
    )

    const running = await Mount.start(app, document.createElement("div"), Navigation.browserLayer)

    try {
      window.history.pushState(null, "", "/next")
      window.dispatchEvent(new PopStateEvent("popstate"))
      await vi.waitFor(() => expect(kinds).toEqual(["popstate"]))
      window.history.replaceState(null, "", "/next#details")
      window.dispatchEvent(new HashChangeEvent("hashchange"))
      await vi.waitFor(() => expect(kinds).toEqual(["popstate", "hashchange"]))
    } finally {
      await running.dispose()
      window.history.replaceState(null, "", old)
    }
  })

  it.each([true, false])("retains user intent callbacks when prefetch is %s", async (prefetch) => {
    let focus = 0
    let pointer = 0

    const app = Application.make<Navigation.Service>()(
      Effect.gen(function* () {
        const Anchor = yield* Link.make()

        return (
          <Anchor
            to="/about"
            prefetch={prefetch}
            onFocus={() => {
              focus += 1
            }}
            onPointerEnter={() => {
              pointer += 1
            }}
          >
            About
          </Anchor>
        )
      })
    )

    const running = await Mount.start(app, document.createElement("div"), Navigation.memoryLayer())

    try {
      const anchor = running.container.querySelector("a")!
      anchor.dispatchEvent(new FocusEvent("focus"))
      anchor.dispatchEvent(new PointerEvent("pointerenter"))
      expect(focus).toBe(1)
      expect(pointer).toBe(1)
    } finally {
      await running.dispose()
    }
  })

  it("keeps separate browser applications in sync after programmatic navigation", async () => {
    const old = window.location.href
    window.history.replaceState(null, "", "/")

    const makeApp = () =>
      Application.make<Navigation.Service>()(
        Effect.gen(function* () {
          const Anchor = yield* Link.make()

          const Outlet = yield* Router.make({
            routes: [
              { path: "/", render: () => <p>Home</p> },
              { path: "/about", render: () => <p>About page</p> }
            ]
          })

          return (
            <>
              <Anchor to="/about">About</Anchor>
              <Outlet />
            </>
          )
        })
      )

    const first = await Mount.start(
      makeApp(),
      document.createElement("div"),
      Navigation.browserLayer
    )

    const second = await Mount.start(
      makeApp(),
      document.createElement("div"),
      Navigation.browserLayer
    )

    try {
      expect(second.container.textContent).toContain("Home")
      first.container.querySelector("a")!.click()
      await vi.waitFor(() => expect(first.container.textContent).toContain("About page"))
      await vi.waitFor(() => expect(second.container.textContent).toContain("About page"))
      expect(second.container.querySelector("a")?.getAttribute("aria-current")).toBe("page")
    } finally {
      await first.dispose()
      await second.dispose()
      window.history.replaceState(null, "", old)
    }
  })

  it("resolves plain anchors against memory locations instead of the browser URL", async () => {
    const old = window.location.href
    window.history.replaceState(null, "", "/")

    const app = Application.make<Navigation.Service>()(
      Effect.gen(function* () {
        const Outlet = yield* Router.make({
          routes: [
            { path: "/", render: () => <p>Memory home</p> },
            { path: "/about", render: () => <a href="/">Memory home link</a> }
          ]
        })

        return <Outlet />
      })
    )

    const running = await Mount.start(
      app,
      document.createElement("div"),
      Navigation.memoryLayer("/about")
    )

    try {
      await vi.waitFor(() => expect(running.container.textContent).toContain("Memory home link"))
      running.container.querySelector("a")!.click()
      await vi.waitFor(() => expect(running.container.textContent).toContain("Memory home"))
      expect(window.location.pathname).toBe("/")
    } finally {
      await running.dispose()
      window.history.replaceState(null, "", old)
    }
  })

  it("does not push duplicate history entries for the current acquired link", async () => {
    const old = window.location.href
    window.history.replaceState(null, "", "/about")
    let clicks = 0

    const app = Application.make<Navigation.Service>()(
      Effect.gen(function* () {
        const Anchor = yield* Link.make()

        const Outlet = yield* Router.make({
          routes: [
            { path: "/", render: () => <p>Home</p> },
            { path: "/about", render: () => <p>About page</p> }
          ]
        })

        return (
          <>
            <Anchor
              to="/about"
              onClick={() => {
                clicks += 1
              }}
            >
              About
            </Anchor>
            <Outlet />
          </>
        )
      })
    )

    const running = await Mount.start(app, document.createElement("div"), Navigation.browserLayer)

    try {
      await vi.waitFor(() => expect(running.container.textContent).toContain("About page"))
      const length = window.history.length
      const anchor = running.container.querySelector("a")!
      anchor.click()
      anchor.click()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(clicks).toBe(2)
      expect(window.history.length).toBe(length)
      expect(window.location.pathname).toBe("/about")
      expect(running.container.textContent).toContain("About page")
    } finally {
      await running.dispose()
      window.history.replaceState(null, "", old)
    }
  })
})
