# API reference

The supported import is `@effect/ui`. Test helpers are provided separately at
`@effect/ui/testing`. JSX requires `jsx: "react-jsx"` and
`jsxImportSource: "@effect/ui"` in `tsconfig.json`.

## Components and signals

- `defineComponent(render)` accepts either `(props) => JSX` or
  `(props) => Effect<JSX, E, R>`. The renderer runs once at mount; use `Signal`
  for fine-grained updates.
- `Signal.make(value)` creates reactive state. `get`, `set`, `update`, `map`,
  and `changes` are Effects/Streams; `.value` is an unsafe synchronous snapshot.
- `Signal.memo(dependencies, select, equals?)` derives a cached selector that
  updates only when an explicit dependency changes and its result is unequal.
  Its subscriptions are owned by the current Effect scope.
- `Resource.make(effect)` starts a scoped load and exposes a read-only state
  signal, a state-change stream, `refresh`, and `cancel`. Pending/failure states
  retain the last successful value.
- `ResourceCache.make()` creates a scope-owned keyed cache. Define typed keys
  with `ResourceCache.key(id, identify, load, staleTime)`; `get` shares pending
  work and revalidates stale results, while `invalidate` and `clear` cancel
  active loads. The default stale time is zero.
- `<Image src alt width height>` renders a native image with lazy loading by
  default, required accessible text/intrinsic dimensions, and failure fallback.
  `decode` waits for native image decoding; `Image.preload(src, options)` returns
  a typed Effect and relies on the browser's HTTP cache.
- `mount(component, container, layer, options?)` returns a handle with
  `runtime` and asynchronous `dispose()`. `options` supports root `props` and
  `onError`.
- `createRef<T>()` creates a typed object ref. Callback refs receive `T` on
  mount and `null` on disposal.
- `onMount(callback)` and `onCleanup(callback)` register component lifecycle
  callbacks. Promise-returning callbacks are awaited during disposal.

## HTTP

- `@effect/ui/http` re-exports Effect's `HttpClient`, request, response, error,
  and Fetch client modules.
- `Http.browserLayer(options?)` provides Effect's Fetch client. `fetch` injects
  a Fetch-compatible transport; `requestInit` supplies default Fetch options;
  `configureClient` applies shared client middleware once when the layer builds.
- `Http.withBaseUrl(client, url)` prepends an absolute base URL to requests.
  `Http.throughBff(client, prefix)` prefixes relative browser request paths for
  a same-origin backend-for-frontend (BFF).
- `Http.json(request, schema)` executes a request with the provided client,
  rejects non-success statuses, and decodes its JSON body with the schema.
- Compose request middleware with `HttpClient.mapRequest`, effectful response
  middleware with `HttpClient.transformResponse`, and status validation with
  `HttpClient.filterStatusOk` for lower-level requests. Use
  `HttpClient.retryTransient` for retry schedules and
  `HttpClientResponse.schemaBodyJson(schema)` when you already have a response.
- Use `ResourceCache` around request Effects to share in-flight queries and
  configure stale-time/revalidation. The HTTP integration does not introduce a
  second global cache. Browser-side BFF rewriting cannot bypass CORS or act as a
  transparent network proxy; the BFF must run server-side.

## JSX and controls

- Intrinsic HTML/SVG tags use element-specific native scalar props. Native
  events receive their corresponding event type and concrete `currentTarget`;
  handlers may be native callbacks returning `void` or a closed Effect, or a
  closed Effect directly.
- `<Show when fallback>` and `<For each keyOf>` provide conditional and keyed
  repeated subtrees.
- `<Async effect fallback error?>` renders a fallback while a closed Effect
  initializes an `ElementChild`; pending work is interrupted on disposal.
  `<Async resource fallback error?>` observes an `ElementChild` Resource and
  keeps its last successful subtree visible during refresh.
- `<ErrorBoundary fallback>` scopes render, event, and reactive-update errors.
  A fallback builder receives `(cause, reset)`.
- `startTransition(effect)` yields an Effect action to a lower-priority
  scheduler turn; it does not animate DOM.

## Forms and focus

- `createForm({ initial, validate, onSubmit })` returns Signals for `values`,
  `errors`, and `submitting`, plus `submit`, `reset`, and native `onSubmit`.
  Validation issues are returned as data; Effect failures remain failures.
- `Form.field(form.values, key)` returns a read-only reactive field value plus
  immutable `set` and `update` actions, avoiding repeated object spreads in
  input handlers. Create the field inside the owning Effect scope.
- `focus(ref)`, `blur(ref)`, and `focusFirst(containerRef)` are Effects for
  focusing mounted, sequentially focusable HTML elements.

## Routing

- `<Router routes notFound fallback onBeforeNavigate onAfterNavigate
  scrollRestoration>` matches ordered route trees. Route types allow at most one
  page handler (`render`, `load`, or `lazy`), with handler-free parent nodes.
  Root paths are absolute; nested child paths are relative. Route nodes support
  `layout`, `pending`, `error`, `notFound`, and `children`. `lazy` imports a
  module with a default route renderer; pending/error boundaries apply, and a
  route's import is deduplicated per router.
- `<Link to replace end prefetch>` renders an anchor with active and current-page
  state. Lazy route modules are prefetched on pointer hover/focus by default;
  pass `prefetch={false}` to disable intent prefetching.
- Route `metadata` may be an object or location resolver. Matched parent values
  are inherited and deeper routes override fields. The router restores prior
  title/description values when metadata is absent and when the router is disposed.
- `Navigate(path, { replace? })` is a same-origin navigation Effect.
- `RouteLocation` includes `params`, `pathname`, `search`, and `hash`.
- `RouteNavigation` includes `from`, `to`, and `kind` (`navigate`, `popstate`, or
  `hashchange`). Hooks are synchronous callbacks; thrown errors go to the
  nearest error boundary or mount-level error handler.

## Virtualization

- `Virtualizer.fixedRange(count, itemSize, viewportSize, scrollOffset, overscan)`
  returns fixed-size window geometry (`start`, `end`, `offset`, `totalSize`).
- `VirtualList.make(options)` creates a scope-owned fixed-row listbox controller.
  It exposes visible `rows`, sizing/scroll/resize actions, listbox and option
  attributes, active-descendant state, and arrow/Home/End/page keyboard handling.
- `VirtualTable.make(options)` creates a scope-owned fixed-row/fixed-column grid
  controller. It windows both axes and exposes row/cell ARIA attributes,
  scroll/resize actions, active-cell state, and two-axis keyboard navigation.
- Both collection controllers require unique string or finite-number keys and
  snapshot their input arrays at creation. Recreate them when the collection
  changes; the host is responsible for scroll container and item positioning.

## Testing subpath

`@effect/ui/testing` exports:

- `render(child, { container?, layer?, onError? })`, returning the container,
  mount handle, exact-text queries, and awaited `unmount()`.
- `fireEvent(target, event)` and `fireInput(control, value)` for native DOM
  events.
- `waitFor(assertion, { timeout?, interval? })` and `cleanup()`.

The text queries are intentionally small conveniences, not a replacement for a
complete accessible-role query implementation.
