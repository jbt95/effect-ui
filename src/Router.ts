import { Effect } from "effect"
import { sync } from "./Component.js"
import { Service } from "./Navigation.js"
import { Router as RuntimeRouter } from "./router/Runtime.js"
import type { RouterProps } from "./router/Types.js"

export type {
  RouterProps as Options,
  RouteDefinition,
  RouteLocation,
  RouteMetadata,
  RouteNavigation,
  NavigationKind,
  NavigateOptions,
  LazyRouteModule,
  RouteMetadataResolver,
  RouterProps
} from "./router/Types.js"

/**
 * Acquires `Navigation.Service` and returns a closed router outlet tag.
 * Route loaders must already be closed Effects — acquire or bind their
 * services before constructing the options.
 *
 * ```ts
 * const Outlet = yield* Router.make({
 *   routes: [Route.make("/", { render: () => <p>Home</p> })],
 *   notFound: <p>Page not found</p>
 * })
 * ```
 */
export const make = Effect.fnUntraced(function* (options: Omit<RouterProps, "navigation">) {
  const navigation = yield* Service

  return sync(() => RuntimeRouter({ ...options, navigation }))
})

export {
  browserLayer as layer,
  memoryLayer,
  navigate,
  Service as Navigation
} from "./Navigation.js"
