import { Effect, Layer } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  defineComponent,
  Link,
  mount,
  onCleanup,
  Navigate,
  Router,
  type RouteDefinition,
  type RouteLocation
} from "../src/Index.js"

// @ts-expect-error Route renderers, loaders, and lazy imports are mutually exclusive.
const InvalidMixedRoute: RouteDefinition = {
  path: "/invalid",
  render: () => <p>Immediate page</p>,
  load: () => Effect.succeed(<p>Loaded page</p>)
}

void InvalidMixedRoute

// @ts-expect-error A route without a page handler must be a parent with children.
const InvalidEmptyRoute: RouteDefinition = { path: "/empty" }

void InvalidEmptyRoute

const PageRoutes = [
  { path: "/", render: () => <p>home</p> },
  { path: "/about", render: () => <p>about</p> }
] satisfies ReadonlyArray<RouteDefinition>

const LinkedRoutes = [
  {
    path: "/",
    render: () => (
      <p>
        <a href="/about">about</a>
      </p>
    )
  },
  { path: "/about", render: () => <p>about</p> }
] satisfies ReadonlyArray<RouteDefinition>

const UserRoutes = [
  {
    path: "/users/:id",
    render: (location: RouteLocation) => <p>user {location.params.id}</p>
  }
] satisfies ReadonlyArray<RouteDefinition>

const HashRoutes = [
  { path: "/", render: () => <p>home</p> },
  {
    path: "/about",
    render: (location: RouteLocation) => <p>{`${location.pathname}${location.hash}`}</p>
  }
] satisfies ReadonlyArray<RouteDefinition>

const anchorWithClass = (root: HTMLElement, className: string): HTMLAnchorElement => {
  const anchor = root.querySelector<HTMLAnchorElement>(`a.${className}`)

  if (anchor === null) throw new Error(`no anchor with class ${className}`)

  return anchor
}

const observeDefaultNavigation = (container: HTMLElement): Array<boolean> => {
  const defaultPrevented: Array<boolean> = []
  container.addEventListener("click", (event) => {
    defaultPrevented.push(event.defaultPrevented)
    event.preventDefault()
  })

  return defaultPrevented
}

describe("Router (DOM)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    history.replaceState(null, "", "/")
  })

  it("renders the matching route synchronously on mount", async () => {
    const container = document.createElement("div")
    const App = defineComponent(() => Effect.succeed(<Router routes={PageRoutes} />))

    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toBe("home")
    expect(container.querySelector("p")?.textContent).toBe("home")

    await handle.dispose()
    expect(container.textContent).toBe("")
  })

  it("updates Link active state and uses replace navigation when requested", async () => {
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <>
          <nav>
            <Link to="/" end class="home-link">
              Home
            </Link>
            <Link to="/about" end replace class="about-link">
              About
            </Link>
          </nav>
          <Router routes={PageRoutes} />
        </>
      )
    )

    const replaceState = vi.spyOn(history, "replaceState")
    const pushState = vi.spyOn(history, "pushState")
    const handle = mount(App, container, Layer.empty)

    expect(anchorWithClass(container, "home-link").getAttribute("aria-current")).toBe("page")
    expect(anchorWithClass(container, "about-link").dataset.active).toBe("false")

    anchorWithClass(container, "about-link").click()
    await vi.waitFor(() => {
      expect(container.textContent).toContain("about")
      expect(anchorWithClass(container, "about-link").getAttribute("aria-current")).toBe("page")
    })

    expect(anchorWithClass(container, "home-link").dataset.active).toBe("false")
    expect(replaceState).toHaveBeenCalledOnce()
    expect(pushState).not.toHaveBeenCalled()

    await handle.dispose()
  })

  it("preserves Link callbacks and browser behavior for modified and external clicks", async () => {
    const container = document.createElement("div")
    const onClick = vi.fn()

    const App = defineComponent(() =>
      Effect.succeed(
        <>
          <Link to="/about" class="app-link" onClick={onClick}>
            About
          </Link>
          <Router routes={PageRoutes} />
        </>
      )
    )

    const handle = mount(App, container, Layer.empty)
    const link = anchorWithClass(container, "app-link")
    const defaultPrevented = observeDefaultNavigation(container)

    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }))
    expect(window.location.pathname).toBe("/")
    expect(defaultPrevented).toEqual([false])
    expect(onClick).toHaveBeenCalledOnce()

    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(window.location.pathname).toBe("/about"))
    expect(defaultPrevented).toEqual([false, true])
    expect(onClick).toHaveBeenCalledTimes(2)

    await handle.dispose()
  })

  it("marks non-exact ancestor links active without claiming the current page", async () => {
    history.replaceState(null, "", "/users/42")
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <>
          <Link to="/" class="root-link">
            Root
          </Link>
          <Link to="/users" class="users-link">
            Users
          </Link>
          <Link to="/users" end class="exact-users-link">
            Exact
          </Link>
        </>
      )
    )

    const handle = mount(App, container, Layer.empty)

    expect(anchorWithClass(container, "root-link").dataset.active).toBe("true")
    expect(anchorWithClass(container, "users-link").dataset.active).toBe("true")
    expect(anchorWithClass(container, "users-link").hasAttribute("aria-current")).toBe(false)
    expect(anchorWithClass(container, "exact-users-link").dataset.active).toBe("false")

    await handle.dispose()
  })

  it("lets Link callbacks cancel navigation and keeps external destinations native", async () => {
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <>
          <Link to="/about" class="cancel-link" onClick={(event) => event.preventDefault()}>
            Cancel
          </Link>
          <Link to="https://example.com/" class="external-link">
            External
          </Link>
        </>
      )
    )

    const handle = mount(App, container, Layer.empty)
    const defaultPrevented = observeDefaultNavigation(container)

    anchorWithClass(container, "cancel-link").click()
    anchorWithClass(container, "external-link").click()

    expect(window.location.pathname).toBe("/")
    expect(defaultPrevented).toEqual([true, false])
    await handle.dispose()
  })

  it("matches path parameters and ignores a trailing slash", async () => {
    history.replaceState(null, "", "/users/42/")
    const container = document.createElement("div")
    const App = defineComponent(() => Effect.succeed(<Router routes={UserRoutes} />))

    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toBe("user 42")

    await handle.dispose()
  })

  it("decodes percent-encoded parameters", async () => {
    history.replaceState(null, "", "/users/a%20b")
    const container = document.createElement("div")
    const App = defineComponent(() => Effect.succeed(<Router routes={UserRoutes} />))

    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toBe("user a b")

    await handle.dispose()
  })

  it("matches literal Unicode route paths", async () => {
    history.replaceState(null, "", "/caf%C3%A9")
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(<Router routes={[{ path: "/café", render: () => <p>café</p> }]} />)
    )

    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toBe("café")

    await handle.dispose()
  })

  it("uses the first matching route", async () => {
    history.replaceState(null, "", "/dup")
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={[
            { path: "/dup", render: () => <p>first</p> },
            { path: "/:name", render: () => <p>second</p> }
          ]}
        />
      )
    )

    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toBe("first")

    await handle.dispose()
  })
  it("requires route paths to start at the URL root", () => {
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(<Router routes={[{ path: "users", render: () => <p>users</p> }]} />)
    )

    expect(() => mount(App, container, Layer.empty)).toThrow(/route paths must start with/)
    expect(container.textContent).toBe("")
  })

  it("exposes the query string and hash to the route", async () => {
    history.replaceState(null, "", "/search?q=effect#top")
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={[
            {
              path: "/search",
              render: (location: RouteLocation) => (
                <p>{`${location.pathname}${location.search}${location.hash}`}</p>
              )
            }
          ]}
        />
      )
    )

    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toBe("/search?q=effect#top")

    await handle.dispose()
  })

  it("renders the fallback element when no route matches", async () => {
    history.replaceState(null, "", "/missing")
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(<Router routes={PageRoutes} fallback={<p>not found</p>} />)
    )

    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toBe("not found")

    await handle.dispose()
    expect(container.textContent).toBe("")
  })

  it("gives the fallback builder the current location", async () => {
    history.replaceState(null, "", "/missing?why=1")
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={PageRoutes}
          fallback={(location: RouteLocation) => (
            <p>{`missing ${location.pathname}${location.search}`}</p>
          )}
        />
      )
    )

    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toBe("missing /missing?why=1")

    await handle.dispose()
  })

  it("renders nested layouts around relative child routes and inherits route params", async () => {
    history.replaceState(null, "", "/users/42")
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={[
            {
              path: "/users",
              layout: (_location, child) => (
                <section>
                  <header>User area</header>
                  {child}
                </section>
              ),
              children: [
                {
                  path: ":id",
                  render: (location) => <p>user {location.params.id}</p>
                }
              ]
            }
          ]}
        />
      )
    )

    const handle = mount(App, container, Layer.empty)

    expect(container.querySelector("header")?.textContent).toBe("User area")
    expect(container.querySelector("p")?.textContent).toBe("user 42")

    await handle.dispose()
  })

  it("uses the deepest route not-found view under its matching layouts", async () => {
    history.replaceState(null, "", "/users/42/unknown")
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={[
            {
              path: "/users/:id",
              layout: (_location, child) => <main>{child}</main>,
              notFound: (location) => <p>Missing from user {location.params.id}</p>,
              children: [
                { path: "settings", render: () => <p>Settings</p> },
                {
                  path: "orders",
                  notFound: (location) => <p>No order page for {location.params.id}</p>,
                  children: [
                    {
                      path: ":orderId",
                      render: (location) => <p>Order {location.params.orderId}</p>
                    }
                  ]
                }
              ]
            }
          ]}
          notFound={<p>Global missing</p>}
        />
      )
    )

    const handle = mount(App, container, Layer.empty)

    expect(container.querySelector("main")?.textContent).toBe("Missing from user 42")

    await Effect.runPromise(Navigate("/users/42/orders/missing/extra"))
    await vi.waitFor(() => expect(container.textContent).toBe("No order page for 42"))

    await handle.dispose()
  })

  it("handles route render and event failures with route-local error UI", async () => {
    const renderContainer = document.createElement("div")
    const renderError = new Error("route render failed")

    const RenderApp = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={[
            {
              path: "/",
              render: () => {
                throw renderError
              },
              error: (cause) => <p>Route error: {String(cause)}</p>
            }
          ]}
        />
      )
    )

    const renderHandle = mount(RenderApp, renderContainer, Layer.empty)

    expect(renderContainer.textContent).toContain("route render failed")
    await renderHandle.dispose()

    const eventContainer = document.createElement("div")
    const eventError = new Error("route action failed")

    const EventApp = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={[
            {
              path: "/",
              render: () => <button onClick={Effect.fail(eventError)}>Action</button>,
              error: (cause) => <p>Action error: {String(cause)}</p>
            }
          ]}
        />
      )
    )

    const eventHandle = mount(EventApp, eventContainer, Layer.empty)

    eventContainer.querySelector("button")!.click()
    await vi.waitFor(() => expect(eventContainer.textContent).toContain("route action failed"))
    await eventHandle.dispose()
  })

  it("shows route pending UI and replaces it with loaded content", async () => {
    let resolveRoute!: (content: JSX.Element) => void

    const loaded = new Promise<JSX.Element>((resolve) => {
      resolveRoute = resolve
    })

    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={[
            {
              path: "/",
              load: () => Effect.promise(() => loaded),
              pending: <p>Loading route</p>,
              error: (cause) => <p>Load error: {String(cause)}</p>
            }
          ]}
        />
      )
    )

    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toBe("Loading route")
    resolveRoute(<strong>Loaded route</strong>)
    await vi.waitFor(() => expect(container.textContent).toBe("Loaded route"))

    await handle.dispose()
  })

  it("cancels a route loader when navigation leaves its route", async () => {
    let interrupted = false
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={[
            {
              path: "/",
              load: () =>
                Effect.never.pipe(
                  Effect.onInterrupt(() =>
                    Effect.sync(() => {
                      interrupted = true
                    })
                  )
                ),
              pending: <p>Loading forever</p>
            },
            { path: "/next", render: () => <p>Next route</p> }
          ]}
        />
      )
    )

    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toBe("Loading forever")
    await Effect.runPromise(Navigate("/next"))
    await vi.waitFor(() => expect(container.textContent).toBe("Next route"))
    expect(interrupted).toBe(true)

    await handle.dispose()
  })

  it("cancels route loaders when the router is disposed", async () => {
    let started = false
    let interrupted = false
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={[
            {
              path: "/",
              load: () =>
                Effect.sync(() => {
                  started = true
                }).pipe(
                  Effect.flatMap(() => Effect.never),
                  Effect.onInterrupt(() =>
                    Effect.sync(() => {
                      interrupted = true
                    })
                  )
                ),
              pending: <p>Loading</p>
            }
          ]}
        />
      )
    )

    const handle = mount(App, container, Layer.empty)

    await vi.waitFor(() => expect(started).toBe(true))
    await handle.dispose()
    expect(interrupted).toBe(true)
    expect(container.textContent).toBe("")
  })

  it("prefetches lazy route modules once on pointer/focus intent and reuses the import", async () => {
    let resolveRoute!: (module: { default: () => JSX.Element }) => void
    let imports = 0

    const loaded = new Promise<{ default: () => JSX.Element }>((resolve) => {
      resolveRoute = resolve
    })

    const routes = [
      { path: "/", render: () => <p>Home</p> },
      {
        path: "/lazy",
        lazy: () => {
          imports += 1

          return loaded
        },
        pending: <p>Loading lazy route</p>
      }
    ] satisfies ReadonlyArray<RouteDefinition>

    const container = document.createElement("div")

    const App = defineComponent(() => (
      <>
        <Link to="/lazy" class="lazy-link">
          Lazy route
        </Link>
        <Router routes={routes} />
      </>
    ))

    const handle = mount(App, container, Layer.empty)
    const link = anchorWithClass(container, "lazy-link")

    link.dispatchEvent(new PointerEvent("pointerenter"))
    link.dispatchEvent(new FocusEvent("focus"))

    await vi.waitFor(() => expect(imports).toBe(1))
    await Effect.runPromise(Navigate("/lazy"))
    await vi.waitFor(() => expect(container.textContent).toContain("Loading lazy route"))

    resolveRoute({ default: () => <p>Loaded lazy route</p> })
    await vi.waitFor(() => expect(container.textContent).toContain("Loaded lazy route"))
    expect(imports).toBe(1)

    await handle.dispose()
  })

  it("keeps modified and external Link intents from prefetching lazy modules", async () => {
    let imports = 0

    const routes = [
      { path: "/", render: () => <p>Home</p> },
      {
        path: "/lazy",
        lazy: async () => {
          imports += 1

          return { default: () => <p>Lazy</p> }
        }
      }
    ] satisfies ReadonlyArray<RouteDefinition>

    const container = document.createElement("div")

    const App = defineComponent(() => (
      <>
        <Link to="/lazy" class="lazy-link">
          Lazy route
        </Link>
        <Link to="https://example.com/lazy" class="external-link">
          External route
        </Link>
        <Router routes={routes} />
      </>
    ))

    const handle = mount(App, container, Layer.empty)
    observeDefaultNavigation(container)

    anchorWithClass(container, "external-link").dispatchEvent(new PointerEvent("pointerenter"))
    anchorWithClass(container, "lazy-link").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true })
    )

    await Promise.resolve()
    expect(imports).toBe(0)
    expect(window.location.pathname).toBe("/")

    await handle.dispose()
  })

  it("does not render a lazy module after navigation cancels its pending import", async () => {
    let resolveRoute!: (module: { default: () => JSX.Element }) => void

    const loaded = new Promise<{ default: () => JSX.Element }>((resolve) => {
      resolveRoute = resolve
    })

    const routes = [
      { path: "/", lazy: () => loaded, pending: <p>Loading</p> },
      { path: "/next", render: () => <p>Next route</p> }
    ] satisfies ReadonlyArray<RouteDefinition>

    const container = document.createElement("div")
    const App = defineComponent(() => <Router routes={routes} />)
    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toBe("Loading")
    await Effect.runPromise(Navigate("/next"))
    await vi.waitFor(() => expect(container.textContent).toBe("Next route"))

    resolveRoute({ default: () => <p>Stale lazy route</p> })
    await Promise.resolve()
    await Promise.resolve()
    expect(container.textContent).toBe("Next route")

    await handle.dispose()
  })

  it("shows route-local error UI when a lazy module fails to import", async () => {
    const container = document.createElement("div")

    const App = defineComponent(() => (
      <Router
        routes={[
          {
            path: "/",
            lazy: async () => Promise.reject(new Error("chunk unavailable")),
            pending: <p>Loading route</p>,
            error: (cause) => <p>Route import failed: {String(cause)}</p>
          }
        ]}
      />
    ))

    const handle = mount(App, container, Layer.empty)

    await vi.waitFor(() => expect(container.textContent).toContain("chunk unavailable"))
    expect(container.textContent).toContain("Route import failed")

    await handle.dispose()
  })

  it("runs navigation hooks in order and restores the browser scroll mode", async () => {
    const originalScrollRestoration = history.scrollRestoration
    const transitions: Array<string> = []
    const container = document.createElement("div")
    history.replaceState({ appState: "preserved" }, "", "/")

    const App = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={PageRoutes}
          onBeforeNavigate={({ from, to, kind }) =>
            transitions.push(`before:${kind}:${from.pathname}->${to.pathname}`)
          }
          onAfterNavigate={({ from, to, kind }) =>
            transitions.push(`after:${kind}:${from.pathname}->${to.pathname}`)
          }
          scrollRestoration="manual"
        />
      )
    )

    const handle = mount(App, container, Layer.empty)

    if ("scrollRestoration" in history) expect(history.scrollRestoration).toBe("manual")

    await Effect.runPromise(Navigate("/about"))
    await vi.waitFor(() => expect(container.textContent).toBe("about"))
    expect(history.state).toEqual({ appState: "preserved" })
    expect(transitions).toEqual(["before:navigate:/->/about", "after:navigate:/->/about"])

    history.pushState(history.state, "", "/")
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }))
    await vi.waitFor(() => expect(container.textContent).toBe("home"))
    expect(transitions.slice(2)).toEqual(["before:popstate:/about->/", "after:popstate:/about->/"])

    await handle.dispose()

    if ("scrollRestoration" in history) {
      expect(history.scrollRestoration).toBe(originalScrollRestoration)
    }
  })

  it("inherits nested route metadata and restores original document values", async () => {
    history.replaceState(null, "", "/docs/api")
    document.title = "Original title"
    const Description = document.createElement("meta")
    Description.name = "description"
    document.head.append(Description)

    const routes = [
      {
        path: "/docs",
        metadata: { title: "Documentation", description: "Product documentation" },
        children: [
          {
            path: ":section",
            metadata: (location: RouteLocation) => ({ title: `${location.params.section} | Docs` }),
            render: (location: RouteLocation) => <p>{location.params.section}</p>
          }
        ]
      },
      { path: "/plain", render: () => <p>Plain route</p> }
    ] satisfies ReadonlyArray<RouteDefinition>

    const container = document.createElement("div")
    const App = defineComponent(() => <Router routes={routes} />)
    const handle = mount(App, container, Layer.empty)

    expect(document.title).toBe("api | Docs")
    expect(Description.getAttribute("content")).toBe("Product documentation")

    await Effect.runPromise(Navigate("/plain"))
    await vi.waitFor(() => expect(container.textContent).toBe("Plain route"))
    expect(document.title).toBe("Original title")
    expect(Description.hasAttribute("content")).toBe(false)

    await handle.dispose()
    expect(document.title).toBe("Original title")
    expect(Description.hasAttribute("content")).toBe(false)
    Description.remove()
  })

  it("removes generated metadata and restores the previous router when one is disposed", async () => {
    history.replaceState(null, "", "/")
    document.title = "Original title"
    document.head.querySelector('meta[name="description"]')?.remove()
    const FirstContainer = document.createElement("div")
    const SecondContainer = document.createElement("div")

    const First = mount(
      defineComponent(() => (
        <Router
          routes={[{ path: "/", metadata: { title: "First" }, render: () => <p>First</p> }]}
        />
      )),
      FirstContainer,
      Layer.empty
    )

    expect(document.title).toBe("First")

    const Second = mount(
      defineComponent(() => (
        <Router
          routes={[
            {
              path: "/",
              metadata: { title: "Second", description: "Second router" },
              render: () => <p>Second</p>
            }
          ]}
        />
      )),
      SecondContainer,
      Layer.empty
    )

    expect(document.title).toBe("Second")
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toBe(
      "Second router"
    )

    await Second.dispose()
    expect(document.title).toBe("First")
    expect(document.head.querySelector('meta[name="description"]')).toBeNull()

    await First.dispose()
    expect(document.title).toBe("Original title")
    expect(document.head.querySelector('meta[name="description"]')).toBeNull()
  })

  it("navigates from an anchor click and pushes a history entry", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    const container = document.createElement("div")
    const App = defineComponent(() => Effect.succeed(<Router routes={LinkedRoutes} />))
    const handle = mount(App, container, Layer.empty)
    const entries = history.length
    const link = container.querySelector<HTMLAnchorElement>("a")

    if (link === null) throw new Error("no anchor rendered")

    link.click()

    await vi.waitFor(() => expect(container.textContent).toBe("about"))
    expect(window.location.pathname).toBe("/about")
    expect(history.length).toBe(entries + 1)
    expect(open).not.toHaveBeenCalled()

    await handle.dispose()
  })

  it("keeps the browser default for modified clicks and non-primary buttons", async () => {
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={[
            {
              path: "/",
              render: () => (
                <p>
                  <a className="meta" href="/about">
                    meta
                  </a>
                  <a className="middle" href="/about">
                    middle
                  </a>
                </p>
              )
            },
            { path: "/about", render: () => <p>about</p> }
          ]}
        />
      )
    )

    const handle = mount(App, container, Layer.empty)
    const defaultPrevented = observeDefaultNavigation(container)

    anchorWithClass(container, "meta").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true })
    )
    anchorWithClass(container, "middle").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 1 })
    )

    expect(window.location.pathname).toBe("/")
    expect(container.textContent).toBe("metamiddle")
    expect(defaultPrevented).toEqual([false, false])

    await handle.dispose()
  })

  it("keeps the browser default for targets, downloads, and external links", async () => {
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={[
            {
              path: "/",
              render: () => (
                <p>
                  <a className="target" href="/about" target="_blank">
                    target
                  </a>
                  <a className="download" href="/about" download="">
                    download
                  </a>
                  <a className="external" href="https://example.com/about">
                    external
                  </a>
                </p>
              )
            },
            { path: "/about", render: () => <p>about</p> }
          ]}
        />
      )
    )

    const handle = mount(App, container, Layer.empty)
    const defaultPrevented = observeDefaultNavigation(container)

    anchorWithClass(container, "target").click()
    anchorWithClass(container, "download").click()
    anchorWithClass(container, "external").click()

    expect(window.location.pathname).toBe("/")
    expect(defaultPrevented).toEqual([false, false, false])

    await handle.dispose()
  })

  it("ignores anchor clicks outside the router range", async () => {
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <div>
          <Router routes={LinkedRoutes} />
          <a className="outside" href="/about">
            outside
          </a>
        </div>
      )
    )

    const handle = mount(App, container, Layer.empty)
    const defaultPrevented = observeDefaultNavigation(container)

    anchorWithClass(container, "outside").click()

    expect(window.location.pathname).toBe("/")
    expect(defaultPrevented).toEqual([false])
    expect(container.textContent).toBe("aboutoutside")

    await handle.dispose()
  })

  it("navigates programmatically and replaces history when asked", async () => {
    const container = document.createElement("div")
    const App = defineComponent(() => Effect.succeed(<Router routes={PageRoutes} />))
    const handle = mount(App, container, Layer.empty)

    await Effect.runPromise(Navigate("/about"))
    await vi.waitFor(() => expect(container.textContent).toBe("about"))
    expect(window.location.pathname).toBe("/about")
    const entries = history.length

    await Effect.runPromise(Navigate("/", { replace: true }))
    await vi.waitFor(() => expect(container.textContent).toBe("home"))
    expect(window.location.pathname).toBe("/")
    expect(history.length).toBe(entries)

    await handle.dispose()
  })

  it("re-renders on popstate", async () => {
    const container = document.createElement("div")
    const App = defineComponent(() => Effect.succeed(<Router routes={PageRoutes} />))
    const handle = mount(App, container, Layer.empty)

    await Effect.runPromise(Navigate("/about"))
    await vi.waitFor(() => expect(container.textContent).toBe("about"))

    history.pushState(null, "", "/")
    window.dispatchEvent(new PopStateEvent("popstate"))

    await vi.waitFor(() => expect(container.textContent).toBe("home"))
    expect(window.location.pathname).toBe("/")

    await handle.dispose()
  })

  it("follows browser back navigation", async () => {
    const container = document.createElement("div")
    const App = defineComponent(() => Effect.succeed(<Router routes={PageRoutes} />))
    const handle = mount(App, container, Layer.empty)

    await Effect.runPromise(Navigate("/about"))
    await vi.waitFor(() => expect(container.textContent).toBe("about"))

    history.back()

    await vi.waitFor(() => expect(container.textContent).toBe("home"))
    expect(window.location.pathname).toBe("/")

    await handle.dispose()
  })

  it("re-renders on hashchange", async () => {
    const container = document.createElement("div")
    const App = defineComponent(() => Effect.succeed(<Router routes={HashRoutes} />))
    const handle = mount(App, container, Layer.empty)
    expect(container.textContent).toBe("home")

    history.pushState(null, "", "/about#team")
    window.dispatchEvent(new HashChangeEvent("hashchange"))

    await vi.waitFor(() => expect(container.textContent).toBe("/about#team"))

    await handle.dispose()
  })

  it("keeps native same-route hash links", async () => {
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={[
            {
              path: "/",
              render: () => (
                <>
                  <a href="#section">jump</a>
                  <p id="section">section</p>
                </>
              )
            }
          ]}
        />
      )
    )

    const handle = mount(App, container, Layer.empty)
    const link = container.querySelector<HTMLAnchorElement>("a")

    if (link === null) throw new Error("no anchor rendered")

    link.click()

    expect(window.location.hash).toBe("#section")
    expect(container.textContent).toBe("jumpsection")

    await handle.dispose()
  })

  it("notifies every mounted router", async () => {
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <>
          <Router routes={PageRoutes} />
          <Router routes={PageRoutes} />
        </>
      )
    )

    const handle = mount(App, container, Layer.empty)
    expect(container.textContent).toBe("homehome")

    await Effect.runPromise(Navigate("/about"))
    await vi.waitFor(() => expect(container.textContent).toBe("aboutabout"))

    await handle.dispose()
    expect(container.textContent).toBe("")
  })

  it("disposes the previous route subtree when navigating away", async () => {
    const container = document.createElement("div")
    let cleanups = 0

    const About = defineComponent(() =>
      Effect.gen(function* () {
        yield* onCleanup(() => {
          cleanups += 1
        })

        return <p>about</p>
      })
    )

    const App = defineComponent(() =>
      Effect.succeed(
        <Router
          routes={[
            { path: "/", render: () => <p>home</p> },
            { path: "/about", render: () => <About /> }
          ]}
        />
      )
    )

    const handle = mount(App, container, Layer.empty)

    await Effect.runPromise(Navigate("/about"))
    await vi.waitFor(() => expect(container.textContent).toBe("about"))
    expect(cleanups).toBe(0)

    await Effect.runPromise(Navigate("/"))
    await vi.waitFor(() => expect(container.textContent).toBe("home"))
    expect(cleanups).toBe(1)

    await handle.dispose()
    expect(cleanups).toBe(1)
  })

  it("removes listeners and the active subtree on disposal", async () => {
    const container = document.createElement("div")
    const App = defineComponent(() => Effect.succeed(<Router routes={LinkedRoutes} />))
    const handle = mount(App, container, Layer.empty)

    await Effect.runPromise(Navigate("/about"))
    await vi.waitFor(() => expect(container.textContent).toBe("about"))

    await handle.dispose()
    expect(container.textContent).toBe("")
    expect(container.childNodes.length).toBe(0)

    // Late navigation must not resurrect the disposed router.
    await Effect.runPromise(Navigate("/"))
    window.dispatchEvent(new PopStateEvent("popstate"))
    window.dispatchEvent(new HashChangeEvent("hashchange"))

    expect(container.textContent).toBe("")
    expect(window.location.pathname).toBe("/")
  })
})
