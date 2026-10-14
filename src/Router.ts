/**
 * Client-side routing. `<Router>` matches the browser location against an
 * ordered route table and renders the first match. Navigation happens either
 * programmatically (`Navigate`) or through unmodified left clicks on
 * same-origin anchors inside the router's DOM range; `popstate` and
 * `hashchange` re-render every mounted router. Browser only: server rendering
 * is intentionally out of scope.
 */

import { Effect } from "effect"
import { defineComponent } from "./Component.js"
import {
  combine,
  Control,
  insert,
  noop,
  removeBetween,
  type Disposer,
  type Host
} from "./Control.js"
import { Fragment, jsx, type ElementChild } from "./Element.js"
import type {
  NavigateOptions,
  RouteDefinition,
  LazyRouteModule,
  RouteLocation,
  RouteMetadata,
  RouteMetadataResolver,
  RouteNavigation,
  NavigationKind,
  RouterProps
} from "./router/Types.js"
import {
  CompileRoutes,
  MatchNotFoundRoute,
  MatchRoute,
  NoParams,
  type CompiledRoutes
} from "./router/Matching.js"
import { NotifyActiveLinks } from "./router/ActiveLinks.js"
import { Async } from "./runtime/Async.js"
import { ErrorBoundary, type ErrorBoundaryProps } from "./runtime/ErrorBoundary.js"

export type {
  NavigateOptions,
  RouteDefinition,
  LazyRouteModule,
  RouteLocation,
  RouteMetadata,
  RouteMetadataResolver,
  RouteNavigation,
  NavigationKind,
  RouterProps
} from "./router/Types.js"

/** A plain snapshot of the browser location. */
interface BrowserLocation {
  readonly Pathname: string
  readonly Search: string
  readonly Hash: string
}

/** Reads the window location into a plain snapshot. */
const ReadLocation = (): BrowserLocation => {
  const { pathname: Pathname, search: Search, hash: Hash } = window.location

  return { Pathname, Search, Hash }
}

/** A mounted router, notified whenever the location may have changed. */
interface RouterOutlet {
  readonly Sync: (Kind?: NavigationKind) => void
  readonly Prefetch: (Path: string) => Promise<void>
}

/** Every router mounted in this window, in mount order. */
const Outlets = new Set<RouterOutlet>()

/** Re-renders every mounted router from the current location. */
const NotifyOutlets = (Kind: NavigationKind = "navigate"): void => {
  for (const Outlet of Array.from(Outlets)) Outlet.Sync(Kind)
}

/** Pushes (or replaces) a same-origin history entry, then updates all routers. */
const ChangeLocation = (Path: string, Replace: boolean): void => {
  const CurrentUrl = new URL(window.location.href)
  const NextUrl = new URL(Path, CurrentUrl)

  if (NextUrl.origin !== CurrentUrl.origin) {
    throw new TypeError("[@effect/ui] client navigation must stay within the current origin")
  }

  const Destination = `${NextUrl.pathname}${NextUrl.search}${NextUrl.hash}`

  const State = window.history.state

  if (Replace) window.history.replaceState(State, "", Destination)
  else window.history.pushState(State, "", Destination)
  NotifyOutlets("navigate")
  NotifyActiveLinks()
}

/**
 * Navigate to a same-origin `path` with the History API and re-render every
 * mounted router. `{ replace: true }` replaces the current history entry.
 */
export const Navigate = (Path: string, Options?: NavigateOptions): Effect.Effect<void> =>
  Effect.sync(() => {
    ChangeLocation(Path, Options?.replace === true)
  })

/**
 * The anchor a click landed on, or `null` when the click missed an anchor.
 * `composedPath` keeps the lookup inside the event's own tree, so a click on
 * nested content still resolves to its enclosing anchor.
 */
const AnchorFromClick = (EventValue: MouseEvent): Element | null => {
  for (const NodeValue of EventValue.composedPath()) {
    if (NodeValue instanceof Element && NodeValue.localName === "a") return NodeValue
  }

  return null
}

/**
 * The same-origin path an anchor points to, or `null` when the browser must
 * keep the click: no usable href, a download, a target, a foreign origin, or a
 * non-hierarchical scheme such as `mailto:`.
 */
const AnchorPath = (Anchor: Element): string | null => {
  const Href = Anchor.getAttribute("href")

  if (Href === null || Href === "") return null

  if (Anchor.hasAttribute("download")) return null
  const Target = Anchor.getAttribute("target")

  if (Target !== null && Target !== "") return null
  let Url: URL

  try {
    // Relative links resolve against the page being navigated.
    Url = new URL(Href, window.location.href)
  } catch {
    return null
  }

  if (Url.origin !== window.location.origin) return null

  return `${Url.pathname}${Url.search}${Url.hash}`
}

/** True when `NodeValue` sits inside the `Start` … `End` comment range. */
const IsInsideRange = (Start: Node, End: Node, NodeValue: Node): boolean => {
  if (NodeValue === Start || NodeValue === End) return true

  if ((Start.compareDocumentPosition(NodeValue) & Node.DOCUMENT_POSITION_FOLLOWING) === 0)
    return false

  return (End.compareDocumentPosition(NodeValue) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
}

interface RouterRuntime {
  readonly Props: RouterProps
  readonly Routes: CompiledRoutes
  readonly LazyModules: Map<RouteDefinition, Promise<LazyRouteModule>>
  readonly Document: Document
  readonly Parent: Node
  readonly Host: Host
  readonly Start: Comment
  readonly End: Comment
  Current: Disposer
  CurrentKey: string | undefined
  CurrentLocation: BrowserLocation
  RequestedLocation: BrowserLocation
  Metadata: RouteMetadata | undefined
  MetadataRegistry: DocumentMetadataRegistry | undefined
  Disposed: boolean
  Transition: Promise<void>
}

interface DocumentMetadataRegistry {
  readonly Document: Document
  readonly OriginalTitle: string
  readonly OriginalDescription: HTMLMetaElement | undefined
  readonly OriginalDescriptionContent: string | null | undefined
  readonly Routers: Array<RouterRuntime>
  CreatedDescription: HTMLMetaElement | undefined
}

const MetadataRegistries = new WeakMap<Document, DocumentMetadataRegistry>()

const IsMetadataResolver = (
  Metadata: RouteMetadata | RouteMetadataResolver
): Metadata is RouteMetadataResolver => typeof Metadata === "function"

const ResolveRouteMetadata = (
  Router: RouterRuntime,
  Location: BrowserLocation
): RouteMetadata | undefined => {
  const Match = MatchRoute(Router.Routes.Matches, Location.Pathname)

  const NotFound =
    Match === undefined ? MatchNotFoundRoute(Router.Routes.NotFound, Location.Pathname) : undefined

  const Chain = Match?.Chain ?? NotFound?.Chain

  if (Chain === undefined) return undefined

  const RouteContext = MakeRouteLocation(Location, Match?.Params ?? NotFound?.Params)

  const Metadata = Chain.map((Route) => ResolveRouteMetadataValue(Route, RouteContext)).reduce(
    MergeRouteMetadata,
    {}
  )

  return Metadata.title === undefined && Metadata.description === undefined ? undefined : Metadata
}

const ResolveRouteMetadataValue = (
  Route: RouteDefinition,
  Location: RouteLocation
): RouteMetadata => {
  const Declared = Route.metadata

  if (Declared === undefined) return {}

  return IsMetadataResolver(Declared) ? Declared(Location) : Declared
}

const MergeRouteMetadata = (Parent: RouteMetadata, Child: RouteMetadata): RouteMetadata => ({
  title: Child.title ?? Parent.title,
  description: Child.description ?? Parent.description
})

const RestoreDescription = (Registry: DocumentMetadataRegistry): void => {
  Registry.CreatedDescription?.remove()
  Registry.CreatedDescription = undefined

  if (Registry.OriginalDescription === undefined) return

  if (Registry.OriginalDescriptionContent === null) {
    Registry.OriginalDescription.removeAttribute("content")
  } else if (Registry.OriginalDescriptionContent !== undefined) {
    Registry.OriginalDescription.setAttribute("content", Registry.OriginalDescriptionContent)
  }
}

const ApplyDescription = (
  Registry: DocumentMetadataRegistry,
  Description: string | undefined
): void => {
  if (Description === undefined) {
    RestoreDescription(Registry)

    return
  }

  const Meta =
    Registry.OriginalDescription ??
    Registry.CreatedDescription ??
    Registry.Document.createElement("meta")

  if (Registry.OriginalDescription === undefined && Registry.CreatedDescription === undefined) {
    Meta.setAttribute("name", "description")
    Registry.Document.head.append(Meta)
    Registry.CreatedDescription = Meta
  }

  Meta.setAttribute("content", Description)
}

const RefreshDocumentMetadata = (Registry: DocumentMetadataRegistry): void => {
  const Owner = Registry.Routers[Registry.Routers.length - 1]
  const Metadata = Owner?.Metadata

  Registry.Document.title = Metadata?.title ?? Registry.OriginalTitle
  ApplyDescription(Registry, Metadata?.description)
}

const RegisterDocumentMetadata = (Router: RouterRuntime): void => {
  const Existing = MetadataRegistries.get(Router.Document)

  const Description =
    Existing === undefined
      ? (Router.Document.head.querySelector<HTMLMetaElement>('meta[name="description"]') ??
        undefined)
      : Existing.OriginalDescription

  const Registry = Existing ?? {
    Document: Router.Document,
    OriginalTitle: Router.Document.title,
    OriginalDescription: Description,
    OriginalDescriptionContent: Description?.getAttribute("content"),
    Routers: [],
    CreatedDescription: undefined
  }

  if (Existing === undefined) MetadataRegistries.set(Router.Document, Registry)

  Registry.Routers.push(Router)
  Router.MetadataRegistry = Registry
  RefreshDocumentMetadata(Registry)
}

const UnregisterDocumentMetadata = (Router: RouterRuntime): void => {
  const Registry = Router.MetadataRegistry

  if (Registry === undefined) return

  const Index = Registry.Routers.indexOf(Router)

  if (Index >= 0) Registry.Routers.splice(Index, 1)

  Router.MetadataRegistry = undefined
  RefreshDocumentMetadata(Registry)

  if (Registry.Routers.length === 0) MetadataRegistries.delete(Registry.Document)
}

const SyncDocumentMetadata = (Router: RouterRuntime, Location: BrowserLocation): void => {
  const Registry = Router.MetadataRegistry

  if (Registry === undefined) return

  try {
    Router.Metadata = ResolveRouteMetadata(Router, Location)
  } catch (Cause) {
    Router.Metadata = undefined
    Router.Host.reportError(Cause)
  }

  RefreshDocumentMetadata(Registry)
}

const MakeRouteLocation = (
  Location: BrowserLocation,
  Params: Readonly<Record<string, string>> = NoParams
): RouteLocation => ({
  params: Params,
  pathname: Location.Pathname,
  search: Location.Search,
  hash: Location.Hash
})

const LoadLazyRoute = (Router: RouterRuntime, Route: RouteDefinition): Promise<LazyRouteModule> => {
  const Existing = Router.LazyModules.get(Route)

  if (Existing !== undefined) return Existing

  if (Route.lazy === undefined) {
    return Promise.reject(
      new TypeError("[@effect/ui] attempted to load a route without a lazy module")
    )
  }

  const Pending = Promise.resolve()
    .then(Route.lazy)
    .catch((Cause) => {
      if (Router.LazyModules.get(Route) === Pending) Router.LazyModules.delete(Route)

      throw Cause
    })

  Router.LazyModules.set(Route, Pending)

  return Pending
}

const LazyRouteContent = (Build: () => ElementChild): ElementChild =>
  jsx(
    defineComponent(() => Effect.sync(() => jsx(Fragment, { children: Build() }))),
    {}
  )

const RouteErrorBoundary = (
  fallback: ErrorBoundaryProps["fallback"],
  children: ElementChild
): ElementChild => ErrorBoundary({ fallback, children })

const BuildMatchedRoute = (
  Chain: ReadonlyArray<RouteDefinition>,
  Location: RouteLocation,
  BuildPage: () => ElementChild
): ElementChild => {
  let Child = LazyRouteContent(BuildPage)

  for (let Index = Chain.length - 1; Index >= 0; Index -= 1) {
    const Route = Chain[Index]

    if (Route.layout !== undefined) {
      const LayoutChild = Child
      Child = LazyRouteContent(() => Route.layout!(Location, LayoutChild))
    }

    if (Route.error !== undefined) {
      const ErrorChild = Child
      Child = RouteErrorBoundary((Cause, Reset) => Route.error!(Cause, Reset), ErrorChild)
    }
  }

  return Child
}

const IsNotFoundBuilder = (
  Value: RouterProps["notFound"]
): Value is (Location: RouteLocation) => ElementChild => typeof Value === "function"

const GlobalNotFound = (Router: RouterRuntime, Location: RouteLocation): ElementChild => {
  const Content = Router.Props.notFound ?? Router.Props.fallback

  if (Content === undefined) return undefined

  return IsNotFoundBuilder(Content) ? LazyRouteContent(() => Content(Location)) : Content
}

const RenderMatchedRoute = (
  Router: RouterRuntime,
  Match: NonNullable<ReturnType<typeof MatchRoute>>,
  Location: BrowserLocation
): ElementChild => {
  const RouteContext = MakeRouteLocation(Location, Match.Params)

  return BuildMatchedRoute(Match.Chain, RouteContext, () => {
    if (Match.Route.lazy !== undefined) {
      return jsx(Async, {
        effect: Effect.map(
          Effect.promise(() => LoadLazyRoute(Router, Match.Route)),
          (Module) => Module.default(RouteContext)
        ),
        fallback: Match.Route.pending
      })
    }

    if (Match.Route.load !== undefined) {
      return jsx(Async, {
        effect: Match.Route.load(RouteContext),
        fallback: Match.Route.pending
      })
    }

    return Match.Route.render!(RouteContext)
  })
}

const RenderRouteNotFound = (
  Location: BrowserLocation,
  RouteNotFound: NonNullable<ReturnType<typeof MatchNotFoundRoute>>
): ElementChild => {
  const RouteContext = MakeRouteLocation(Location, RouteNotFound.Params)
  const NotFoundContent = RouteNotFound.Route.notFound!

  return BuildMatchedRoute(RouteNotFound.Chain, RouteContext, () =>
    IsNotFoundBuilder(NotFoundContent) ? NotFoundContent(RouteContext) : NotFoundContent
  )
}

const RenderChild = (Router: RouterRuntime, Location: BrowserLocation): ElementChild => {
  const Match = MatchRoute(Router.Routes.Matches, Location.Pathname)

  if (Match !== undefined) return RenderMatchedRoute(Router, Match, Location)

  const RouteNotFound = MatchNotFoundRoute(Router.Routes.NotFound, Location.Pathname)

  if (RouteNotFound !== undefined) return RenderRouteNotFound(Location, RouteNotFound)

  return GlobalNotFound(Router, MakeRouteLocation(Location))
}

const clearPreviousRoute = async (Router: RouterRuntime, Key: string): Promise<void> => {
  Router.CurrentKey = Key
  const DisposePrevious = Router.Current
  Router.Current = noop
  const Cleanup = DisposePrevious()
  removeBetween(Router.Start, Router.End)

  try {
    await Cleanup
  } catch (cause) {
    Router.Host.reportError(cause)
  }
}

const renderCurrentRoute = (Router: RouterRuntime, Location: BrowserLocation): void => {
  if (Router.Disposed) return

  try {
    Router.Current = Router.Host.renderNode(
      RenderChild(Router, Location),
      Router.Parent,
      Router.End
    )
  } catch (cause) {
    Router.CurrentKey = undefined
    removeBetween(Router.Start, Router.End)
    Router.Host.reportError(cause)
  }
}

const RenderLocation = async (Router: RouterRuntime, Location: BrowserLocation): Promise<void> => {
  const Key = `${Location.Pathname}${Location.Search}${Location.Hash}`

  if (Router.Disposed || Key === Router.CurrentKey) return

  await clearPreviousRoute(Router, Key)
  renderCurrentRoute(Router, Location)
  Router.CurrentLocation = Location
  SyncDocumentMetadata(Router, Location)
}

const ReportNavigationHook = (
  Router: RouterRuntime,
  Hook: ((navigation: RouteNavigation) => void) | undefined,
  Navigation: RouteNavigation
): void => {
  if (Hook === undefined) return

  try {
    Hook(Navigation)
  } catch (error) {
    Router.Host.reportError(error)
  }
}

const RouteLocationFor = (Router: RouterRuntime, Location: BrowserLocation): RouteLocation => {
  const Match = MatchRoute(Router.Routes.Matches, Location.Pathname)

  if (Match !== undefined) return MakeRouteLocation(Location, Match.Params)

  const NotFound = MatchNotFoundRoute(Router.Routes.NotFound, Location.Pathname)

  return MakeRouteLocation(Location, NotFound?.Params)
}

const SyncRouter = (Router: RouterRuntime, Kind: NavigationKind = "navigate"): void => {
  if (Router.Disposed) return
  const Location = ReadLocation()

  if (LocationKey(Location) === LocationKey(Router.RequestedLocation)) return

  const Navigation = MakeNavigation(Router, Router.RequestedLocation, Location, Kind)
  Router.RequestedLocation = Location
  QueueNavigation(Router, Location, Navigation)
}

const PrefetchRouter = async (Router: RouterRuntime, Path: string): Promise<void> => {
  const Match = MatchRoute(Router.Routes.Matches, Path)

  if (Match === undefined) return

  await Promise.all(
    Match.Chain.filter((Route) => Route.lazy !== undefined).map((Route) =>
      LoadLazyRoute(Router, Route)
    )
  )
}

const ResolveInternalPath = (Path: string): string | undefined => {
  try {
    const Destination = new URL(Path, window.location.href)

    if (Destination.origin !== window.location.origin) return undefined

    return Destination.pathname
  } catch {
    return undefined
  }
}

/** Preloads matching lazy route modules for a same-origin destination. */
export const Prefetch = (Path: string): Promise<void> => {
  const InternalPath = ResolveInternalPath(Path)

  if (InternalPath === undefined) return Promise.resolve()

  return Promise.all(Array.from(Outlets, (Outlet) => Outlet.Prefetch(InternalPath))).then(
    () => undefined
  )
}

const LocationKey = (Location: BrowserLocation): string =>
  `${Location.Pathname}${Location.Search}${Location.Hash}`

const MakeNavigation = (
  Router: RouterRuntime,
  From: BrowserLocation,
  To: BrowserLocation,
  Kind: NavigationKind
): RouteNavigation => ({
  from: RouteLocationFor(Router, From),
  to: RouteLocationFor(Router, To),
  kind: Kind
})

const QueueNavigation = (
  Router: RouterRuntime,
  Location: BrowserLocation,
  Navigation: RouteNavigation
): void => {
  const Transition = async (): Promise<void> => {
    if (Router.Disposed) return

    ReportNavigationHook(Router, Router.Props.onBeforeNavigate, Navigation)
    await RenderLocation(Router, Location)

    if (Router.Disposed) return

    ReportNavigationHook(Router, Router.Props.onAfterNavigate, Navigation)
  }

  Router.Transition = Router.Transition.then(Transition, (error) => {
    Router.Host.reportError(error)

    return Transition()
  })
}

const IsUnmodifiedLeftClick = (EventValue: MouseEvent): boolean =>
  EventValue.button === 0 &&
  !EventValue.defaultPrevented &&
  !EventValue.metaKey &&
  !EventValue.ctrlKey &&
  !EventValue.shiftKey &&
  !EventValue.altKey

const HandleSamePathClick = (EventValue: MouseEvent, Path: string, Destination: URL): boolean => {
  if (
    Destination.pathname !== window.location.pathname ||
    Destination.search !== window.location.search
  ) {
    return false
  }

  if (Destination.hash !== "") return true
  EventValue.preventDefault()

  if (Destination.hash !== window.location.hash) ChangeLocation(Path, false)

  return true
}

const OnClick = (Router: RouterRuntime, EventValue: Event): void => {
  if (!(EventValue instanceof MouseEvent) || !IsUnmodifiedLeftClick(EventValue)) return

  const Clicked = AnchorFromClick(EventValue)

  if (Clicked === null || !IsInsideRange(Router.Start, Router.End, Clicked)) return
  const Path = AnchorPath(Clicked)

  if (Path === null) return

  const Destination = new URL(Path, window.location.href)

  if (HandleSamePathClick(EventValue, Path, Destination)) return
  EventValue.preventDefault()
  ChangeLocation(Path, false)
}

const RemoveRouterRange = (Router: RouterRuntime): void => {
  removeBetween(Router.Start, Router.End)
  Router.Start.remove()
  Router.End.remove()
}

const RemoveRouterListeners = (
  Router: RouterRuntime,
  Outlet: RouterOutlet,
  ClickHandler: (EventValue: Event) => void,
  PopHandler: () => void,
  HashHandler: () => void
): void => {
  Outlets.delete(Outlet)
  Router.Parent.removeEventListener("click", ClickHandler)
  window.removeEventListener("popstate", PopHandler)
  window.removeEventListener("hashchange", HashHandler)
}

const ScrollRestorationRouters = new Map<RouterRuntime, "auto" | "manual">()

let PreviousScrollRestoration: ScrollRestoration | undefined

const UpdateScrollRestoration = (): void => {
  if (!("scrollRestoration" in window.history)) return

  if (ScrollRestorationRouters.size === 0) {
    if (PreviousScrollRestoration !== undefined) {
      window.history.scrollRestoration = PreviousScrollRestoration
      PreviousScrollRestoration = undefined
    }

    return
  }

  window.history.scrollRestoration = Array.from(ScrollRestorationRouters.values()).includes(
    "manual"
  )
    ? "manual"
    : "auto"
}

const RegisterScrollRestoration = (Router: RouterRuntime): (() => void) => {
  const Mode = Router.Props.scrollRestoration

  if (Mode === undefined || !("scrollRestoration" in window.history)) return () => {}

  if (ScrollRestorationRouters.size === 0) {
    PreviousScrollRestoration = window.history.scrollRestoration
  }

  ScrollRestorationRouters.set(Router, Mode)
  UpdateScrollRestoration()

  return () => {
    ScrollRestorationRouters.delete(Router)
    UpdateScrollRestoration()
  }
}

const DisposeRouter = async (Router: RouterRuntime, RemoveListeners: () => void): Promise<void> => {
  Router.Disposed = true
  RemoveListeners()
  UnregisterDocumentMetadata(Router)
  const Cleanup = combine([Router.Current, () => Router.Transition])()
  Router.Current = noop
  Router.LazyModules.clear()
  RemoveRouterRange(Router)
  await Cleanup
}

interface RouterAnchorRange {
  readonly Document: Document
  readonly Start: Comment
  readonly End: Comment
}

const createRouterAnchorRange = (Parent: Node, Anchor?: Node | null): RouterAnchorRange => {
  const Document = Parent.ownerDocument ?? document
  const Start = Document.createComment("router")
  const End = Document.createComment("/router")
  insert(Parent, Start, Anchor)
  insert(Parent, End, Anchor)

  return { Document, Start, End }
}

const createRouterRuntime = (
  Props: RouterProps,
  Parent: Node,
  RendererHost: Host,
  Anchor?: Node | null
): RouterRuntime => {
  const Routes = CompileRoutes(Props.routes)
  const { Document, Start, End } = createRouterAnchorRange(Parent, Anchor)
  const InitialLocation = ReadLocation()

  return {
    Props,
    Routes,
    LazyModules: new Map(),
    Document,
    Parent,
    Host: RendererHost,
    Start,
    End,
    Current: noop,
    CurrentKey: undefined,
    CurrentLocation: InitialLocation,
    RequestedLocation: InitialLocation,
    Metadata: undefined,
    MetadataRegistry: undefined,
    Disposed: false,
    Transition: Promise.resolve()
  }
}

const installRouterListeners = (Router: RouterRuntime): (() => void) => {
  const Outlet: RouterOutlet = {
    Sync: (Kind) => SyncRouter(Router, Kind),
    Prefetch: (Path) => PrefetchRouter(Router, Path)
  }

  const ClickHandler = (EventValue: Event): void => OnClick(Router, EventValue)
  const PopHandler = (): void => SyncRouter(Router, "popstate")
  const HashHandler = (): void => SyncRouter(Router, "hashchange")
  const RemoveScrollRestoration = RegisterScrollRestoration(Router)
  Outlets.add(Outlet)
  Router.Parent.addEventListener("click", ClickHandler)
  window.addEventListener("popstate", PopHandler)
  window.addEventListener("hashchange", HashHandler)

  return () => {
    RemoveRouterListeners(Router, Outlet, ClickHandler, PopHandler, HashHandler)
    RemoveScrollRestoration()
  }
}

const renderInitialRouterLocation = (Router: RouterRuntime): void => {
  const Initial = ReadLocation()
  Router.Current = Router.Host.renderNode(RenderChild(Router, Initial), Router.Parent, Router.End)
  Router.CurrentKey = `${Initial.Pathname}${Initial.Search}${Initial.Hash}`
  Router.CurrentLocation = Initial
  Router.RequestedLocation = Initial
  SyncDocumentMetadata(Router, Initial)
}

const RouterControl = (
  Props: RouterProps,
  Parent: Node,
  RendererHost: Host,
  Anchor?: Node | null
): Disposer => {
  const Router = createRouterRuntime(Props, Parent, RendererHost, Anchor)
  RegisterDocumentMetadata(Router)
  const RemoveListeners = installRouterListeners(Router)

  try {
    renderInitialRouterLocation(Router)
  } catch (cause) {
    RemoveListeners()
    UnregisterDocumentMetadata(Router)
    RemoveRouterRange(Router)
    throw cause
  }

  return () => DisposeRouter(Router, RemoveListeners)
}

/** JSX control that renders the route matching the current browser location. */
export const Router: Control<RouterProps> = Control.make("control/router", RouterControl)
