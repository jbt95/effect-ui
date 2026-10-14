import type { ElementChild } from "../Element.js"
import type { Effect } from "effect"

/** The URL parts a matched route can read. */
export interface RouteLocation {
  /** Path parameters captured from `:name` segments. */
  readonly params: Readonly<Record<string, string>>
  /** `window.location.pathname`. */
  readonly pathname: string
  /** `window.location.search`, including its leading `?` when present. */
  readonly search: string
  /** `window.location.hash`, including its leading `#` when present. */
  readonly hash: string
}

/** The default view exported by a lazily imported route module. */
export interface LazyRouteModule {
  readonly default: (location: RouteLocation) => ElementChild
}

/** Document metadata contributed by a matched route. */
export interface RouteMetadata {
  /** Browser document title. */
  readonly title?: string
  /** Content of the document's `meta[name="description"]` element. */
  readonly description?: string
}

export type RouteMetadataResolver = (location: RouteLocation) => RouteMetadata

interface RouteDefinitionBase {
  /** Path pattern: `/`, `/users` at the root; `:id` or `settings` below a parent. */
  readonly path: string
  /** Pending UI used while `load` runs or a `lazy` route module imports. */
  readonly pending?: ElementChild
  /** Wraps this route's page or matched child route. */
  readonly layout?: (location: RouteLocation, child: ElementChild) => ElementChild
  /** Local error UI for render, event, and reactive failures within this route. */
  readonly error?: (cause: unknown, reset: () => void) => ElementChild
  /** UI for unmatched descendants beneath this route. */
  readonly notFound?: ElementChild | ((location: RouteLocation) => ElementChild)
  /** Metadata inherited from parent routes and overridden by deeper matches. */
  readonly metadata?: RouteMetadata | RouteMetadataResolver
  /** Ordered child route definitions. */
  readonly children?: ReadonlyArray<RouteDefinition>
}

type RoutePageDefinition =
  | {
      /** Builds synchronous route content. */
      readonly render: (location: RouteLocation) => ElementChild
      readonly load?: never
      readonly lazy?: never
    }
  | {
      /** Loads route content asynchronously; pending UI is shown while it runs. */
      readonly load: (location: RouteLocation) => Effect.Effect<ElementChild, unknown, never>
      readonly render?: never
      readonly lazy?: never
    }
  | {
      /** Imports a route module on demand. Its default export renders the page. */
      readonly lazy: () => Promise<LazyRouteModule>
      readonly render?: never
      readonly load?: never
    }
  | {
      /** Parent route with children/not-found content and no page of its own. */
      readonly render?: never
      readonly load?: never
      readonly lazy?: never
      readonly children: ReadonlyArray<RouteDefinition>
    }

/** A route tree node. Root paths are absolute; nested child paths are relative. */
export type RouteDefinition = RouteDefinitionBase & RoutePageDefinition

/** Options accepted by `Navigate`. */
export interface NavigateOptions {
  /** Replace the current history entry instead of pushing a new one. */
  readonly replace?: boolean
}

export interface RouterProps {
  /** Ordered route table. */
  readonly routes: ReadonlyArray<RouteDefinition>
  /** Not-found content, or a builder, rendered when no route matches. */
  readonly notFound?: ElementChild | ((location: RouteLocation) => ElementChild)
  /** @deprecated Use `notFound`. */
  readonly fallback?: ElementChild | ((location: RouteLocation) => ElementChild)
  /** Called after a URL change is accepted but before the destination renders. */
  readonly onBeforeNavigate?: (navigation: RouteNavigation) => void
  /** Called after the destination route has rendered. */
  readonly onAfterNavigate?: (navigation: RouteNavigation) => void
  /** Select the browser's shared native History API scroll restoration mode. */
  readonly scrollRestoration?: "auto" | "manual"
}

export type NavigationKind = "navigate" | "popstate" | "hashchange"

export interface RouteNavigation {
  readonly from: RouteLocation
  readonly to: RouteLocation
  readonly kind: NavigationKind
}
