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

export interface Location {
  readonly href: string
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

export class NavigationError extends Data.TaggedError("NavigationError")<{
  readonly path: string
  readonly reason: string
}> {}

export interface Provider {
  readonly location: Source<Location>
  readonly navigate: (
    path: string,
    options?: NavigateOptions
  ) => Effect.Effect<void, NavigationError>
  readonly prefetch: (path: string) => Effect.Effect<void, NavigationError>
}

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

export const browserLayer = Layer.effect(Service, browser)

export const memoryLayer = (initial?: string) => Layer.effect(Service, memory(initial))

export const navigate = (path: string, options?: NavigateOptions) =>
  Service.use((provider) => provider.navigate(path, options))

export const prefetch = (path: string) => Service.use((provider) => provider.prefetch(path))
