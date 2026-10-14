import type { RouteDefinition } from "./Types.js"

/** Shared empty parameter map for routes that capture nothing. */
export const NoParams: Readonly<Record<string, string>> = Object.freeze({})

export interface CompiledRoute {
  readonly Route: RouteDefinition
  readonly Segments: ReadonlyArray<string>
  readonly Chain: ReadonlyArray<RouteDefinition>
}

export interface CompiledNotFoundRoute {
  readonly Route: RouteDefinition
  readonly Segments: ReadonlyArray<string>
  readonly Chain: ReadonlyArray<RouteDefinition>
}

export interface CompiledRoutes {
  readonly Matches: ReadonlyArray<CompiledRoute>
  readonly NotFound: ReadonlyArray<CompiledNotFoundRoute>
}

export interface RouteMatch {
  readonly Route: RouteDefinition
  readonly Params: Readonly<Record<string, string>>
  readonly Chain: ReadonlyArray<RouteDefinition>
}

export interface NotFoundMatch {
  readonly Route: RouteDefinition
  readonly Params: Readonly<Record<string, string>>
  readonly Chain: ReadonlyArray<RouteDefinition>
}

/** Compile and validate route paths once for each mounted router. */
export const CompileRoutes = (Routes: ReadonlyArray<RouteDefinition>): CompiledRoutes => {
  const Compiler: RouteCompiler = { Matches: [], NotFound: [] }

  for (const Route of Routes) CompileRouteNode(Compiler, Route, [], [], true)

  return Compiler
}

interface RouteCompiler {
  readonly Matches: Array<CompiledRoute>
  readonly NotFound: Array<CompiledNotFoundRoute>
}

const CompileRouteNode = (
  Compiler: RouteCompiler,
  Route: RouteDefinition,
  ParentSegments: ReadonlyArray<string>,
  ParentChain: ReadonlyArray<RouteDefinition>,
  IsRoot: boolean
): void => {
  ValidateRouteDefinition(Route, IsRoot)

  const Segments = [...ParentSegments, ...ParseRouteSegments(Route.path)]
  const Chain = [...ParentChain, Route]

  if (Route.notFound !== undefined) Compiler.NotFound.push({ Route, Segments, Chain })

  // Compile children first so an explicit index child wins over its parent.
  for (const Child of Route.children ?? [])
    CompileRouteNode(Compiler, Child, Segments, Chain, false)

  if (Route.render !== undefined || Route.load !== undefined || Route.lazy !== undefined) {
    Compiler.Matches.push({ Route, Segments, Chain })
  }
}

const ValidateRouteDefinition = (Route: RouteDefinition, IsRoot: boolean): void => {
  ValidateRouteHandler(Route)
  ValidateRoutePath(Route.path, IsRoot)
}

const ValidateRouteHandler = (Route: RouteDefinition): void => {
  const PageHandlers = [Route.render, Route.load, Route.lazy].filter(
    (Handler) => Handler !== undefined
  )

  if (PageHandlers.length > 1) {
    throw new TypeError("[@effect/ui] a route must define only one of 'render', 'load', or 'lazy'")
  }

  const HasNoPage =
    Route.render === undefined && Route.load === undefined && Route.lazy === undefined

  const HasNoNotFound = Route.notFound === undefined
  const HasNoChildren = Route.children === undefined || Route.children.length === 0

  if (HasNoPage && HasNoNotFound && HasNoChildren) {
    throw new TypeError("[@effect/ui] a terminal route must define 'render', 'load', or 'lazy'")
  }
}

const ValidateRoutePath = (Path: string, IsRoot: boolean): void => {
  if (IsRoot && !Path.startsWith("/")) {
    throw new TypeError("[@effect/ui] route paths must start with '/'")
  }

  if (!IsRoot && Path.startsWith("/")) {
    throw new TypeError("[@effect/ui] nested route paths must be relative")
  }
}

const ParseRouteSegments = (Path: string): ReadonlyArray<string> => {
  const Segments = Path.split("/")
    .filter((Segment) => Segment.length > 0)
    .map((Segment) => (Segment.startsWith(":") ? Segment : DecodePathSegment(Segment)))

  for (const Segment of Segments) ValidateRouteSegment(Segment)

  return Segments
}

const ValidateRouteSegment = (Segment: string): void => {
  if (Segment.startsWith(":") && !/^:[A-Za-z_][A-Za-z0-9_]*$/.test(Segment)) {
    throw new TypeError(`[@effect/ui] invalid route parameter segment: ${Segment}`)
  }
}

/** Decodes one URL segment while preserving malformed percent sequences. */
const DecodePathSegment = (Segment: string): string => {
  try {
    return decodeURIComponent(Segment)
  } catch {
    return Segment
  }
}

/** Matches path segments and returns the captured parameters, or no match. */
const MatchSegments = (
  RouteSegments: ReadonlyArray<string>,
  PathSegments: ReadonlyArray<string>
): ReadonlyArray<[string, string]> | undefined => {
  if (RouteSegments.length !== PathSegments.length) return undefined
  const Parameters: Array<[string, string]> = []

  for (let Index = 0; Index < RouteSegments.length; Index += 1) {
    const Token = RouteSegments[Index]
    const Segment = PathSegments[Index]

    if (Token.startsWith(":")) Parameters.push([Token.slice(1), Segment])
    else if (Token !== Segment) return undefined
  }

  return Parameters
}

/**
 * The first route whose segments match `Pathname` exactly. A `:name` segment
 * captures the pathname segment in the same position. Empty URL segments are
 * ignored, so leading, trailing, and repeated slashes do not affect matching.
 */
export const MatchRoute = (
  Routes: ReadonlyArray<CompiledRoute>,
  Pathname: string
): RouteMatch | undefined => {
  const Segments = Pathname.split("/")
    .filter((Segment) => Segment.length > 0)
    .map(DecodePathSegment)

  for (const Candidate of Routes) {
    const Parameters = MatchSegments(Candidate.Segments, Segments)

    if (Parameters === undefined) continue

    return {
      Route: Candidate.Route,
      Params: Parameters.length === 0 ? NoParams : Object.fromEntries(Parameters),
      Chain: Candidate.Chain
    }
  }

  return undefined
}

/** Finds the deepest route-owned not-found UI whose path is a prefix of the URL. */
export const MatchNotFoundRoute = (
  Routes: ReadonlyArray<CompiledNotFoundRoute>,
  Pathname: string
): NotFoundMatch | undefined => {
  const Segments = Pathname.split("/")
    .filter((Segment) => Segment.length > 0)
    .map(DecodePathSegment)

  let Best: NotFoundMatch | undefined
  let BestLength = -1

  for (const Candidate of Routes) {
    if (Candidate.Segments.length <= BestLength) continue

    const Parameters = MatchPrefixSegments(Candidate.Segments, Segments)

    if (Parameters === undefined) continue

    Best = {
      Route: Candidate.Route,
      Params: Parameters.length === 0 ? NoParams : Object.fromEntries(Parameters),
      Chain: Candidate.Chain
    }
    BestLength = Candidate.Segments.length
  }

  return Best
}

const MatchPrefixSegments = (
  RouteSegments: ReadonlyArray<string>,
  PathSegments: ReadonlyArray<string>
): ReadonlyArray<[string, string]> | undefined => {
  if (RouteSegments.length > PathSegments.length) return undefined
  const Parameters: Array<[string, string]> = []

  for (let Index = 0; Index < RouteSegments.length; Index += 1) {
    const Token = RouteSegments[Index]
    const Segment = PathSegments[Index]

    if (Token.startsWith(":")) Parameters.push([Token.slice(1), Segment])
    else if (Token !== Segment) return undefined
  }

  return Parameters
}
