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

/** Acquire navigation before creating a closed outlet tag. Loaders are closed Effects. */
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
