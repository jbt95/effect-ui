import { Context, Data, Effect, Layer } from "effect"
import { Signal, type Source, type Writable } from "./Signal.js"
import {
  deferBrowserSync,
  registerBrowserSync,
  snapshotFromWindow,
  type BrowserSnapshot
} from "./router/BrowserSync.js"
import { Navigate, Prefetch } from "./router/Runtime.js"
import type { NavigateOptions } from "./router/Types.js"

/** A plain snapshot of the current location, shared by browser and memory providers. */
export interface Location {
  readonly href: string
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

/** Typed programmatic-navigation failure: invalid or cross-origin destinations, rejected history updates, failed prefetch. */
export class NavigationError extends Data.TaggedError("NavigationError")<{
  readonly path: string
  readonly reason: string
}> {}

/**
 * The navigation capability: a read-only location plus closed navigation
 * actions. Routers and links acquire this service; tests substitute the
 * memory implementation without touching components.
 */
export interface Provider {
  readonly location: Source<Location>
  readonly navigate: (
    path: string,
    options?: NavigateOptions
  ) => Effect.Effect<void, NavigationError>
  readonly prefetch: (path: string) => Effect.Effect<void, NavigationError>
}

/** The navigation capability tag. Provide it with `browserLayer` or `memoryLayer`. */
export class Service extends Context.Service<Service, Provider>()("@effect/ui/Navigation") {}

const location = (url: URL): Location => ({
  href: url.href,
  pathname: url.pathname,
  search: url.search,
  hash: url.hash
})

const destination = (path: string, base: string) =>
  Effect.try({
    try: () => {
      const current = new URL(base)
      const next = new URL(path, current)

      if (next.origin !== current.origin) throw new TypeError("Navigation must remain same-origin")

      return location(next)
    },
    catch: () => new NavigationError({ path, reason: "Invalid or cross-origin destination" })
  })

const navigateMemory = (
  state: Writable<Location>,
  path: string
): Effect.Effect<void, NavigationError> =>
  destination(path, state.value.href).pipe(
    Effect.flatMap((next) => {
      if (next.href === state.value.href) return Effect.void

      return state.set(next)
    })
  )

/**
 * Builds a deterministic in-memory provider. Never touches browser history,
 * so prefetch is a no-op. Prefer it in tests and adapters.
 */
export const memory = Effect.fnUntraced(function* (initial = "/") {
  const state = yield* Signal.make(location(new URL(initial, "https://effect-ui.local")))

  return Service.of({
    location: Signal.readonly(state),
    navigate: (path) => navigateMemory(state, path),
    prefetch: () => Effect.void
  })
})

const syncBrowserState = (state: Writable<Location>, snapshot: BrowserSnapshot): void => {
  try {
    Effect.runSync(state.set(snapshot))
  } catch {
    // A disposed provider must not break global navigation sync.
  }
}

const navigateBrowser = (
  state: Writable<Location>,
  path: string,
  options?: NavigateOptions
): Effect.Effect<void, NavigationError> =>
  destination(path, state.value.href).pipe(
    Effect.flatMap((next) => {
      if (next.href === state.value.href) return Effect.void

      return Effect.try({
        try: () => Effect.runSync(Navigate(path, options)),
        catch: () => new NavigationError({ path, reason: "Browser rejected navigation" })
      })
    })
  )

const attachBrowserSync = (state: Writable<Location>): Effect.Effect<() => void> =>
  Effect.sync(() => {
    const unregister = registerBrowserSync((snapshot) => syncBrowserState(state, snapshot))
    const syncFromWindow = () => deferBrowserSync(snapshotFromWindow())
    window.addEventListener("popstate", syncFromWindow)
    window.addEventListener("hashchange", syncFromWindow)

    return () => {
      unregister()
      window.removeEventListener("popstate", syncFromWindow)
      window.removeEventListener("hashchange", syncFromWindow)
    }
  })

/**
 * Builds the browser provider. Owns `popstate`/`hashchange` listeners in its
 * layer scope and keeps every mounted browser provider in sync after
 * programmatic history changes, so multiple applications never disagree
 * about the URL. Native back/forward keep their `popstate`/`hashchange`
 * hook kinds.
 */
export const browser = Effect.gen(function* () {
  const state = yield* Signal.make(location(new URL(window.location.href)))
  const detach = yield* attachBrowserSync(state)
  yield* Effect.addFinalizer(() => Effect.sync(detach))

  return Service.of({
    location: Signal.readonly(state),
    navigate: (path, options) => navigateBrowser(state, path, options),
    prefetch: (path) =>
      Effect.tryPromise({
        try: () => Prefetch(path),
        catch: () => new NavigationError({ path, reason: "Route prefetch failed" })
      })
  })
})

/** Provides browser-backed navigation. See `browser`. */
export const browserLayer = Layer.effect(Service, browser)

/** Provides deterministic in-memory navigation starting at `initial`. See `memory`. */
export const memoryLayer = (initial?: string) => Layer.effect(Service, memory(initial))

/**
 * Navigates to a same-origin path, replacing the entry with
 * `{ replace: true }`. Clicking the already-current location is a no-op
 * (user callbacks still run). Requires `Service` — bind it with
 * `Action.bind` before placing navigation in event JSX.
 */
export const navigate = (path: string, options?: NavigateOptions) =>
  Service.use((provider) => provider.navigate(path, options))

/** Prefetches lazy route modules for a same-origin destination. Requires `Service`. */
export const prefetch = (path: string) => Service.use((provider) => provider.prefetch(path))
