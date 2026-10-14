# API reference

The canonical root exports are module namespaces:

`Application`, `Mount`, `Component`, `Element`, `Signal`, `Resource`,
`ResourceCache`, `Async`, `Lifecycle`, `Action`, `Form`, `Ref`, `Focus`,
`Transition`, `Http`, `Image`, `Show`, `For`, `ErrorBoundary`, `Router`,
`Route`, `Navigation`, `Link`, `Virtualizer`, `VirtualList`, `VirtualTable`,
and `Testing`.

```ts
import { Component, Signal } from "@effect/ui"
// Equivalent module imports:
import * as ComponentModule from "@effect/ui/Component"
import * as SignalModule from "@effect/ui/Signal"
```

Each namespace has a same-name package subpath. `@effect/ui/testing` and
`@effect/ui/http` also expose the Testing and Http modules. JSX requires
`jsx: "react-jsx"` and `jsxImportSource: "@effect/ui"`; the package provides
both JSX runtimes. Deprecated flat interfaces are isolated in
`@effect/ui/legacy`; this reference describes the namespace API.

## Component acquisition

### `Component.make(acquire)`

Accepts an Effect that returns a renderer:

```ts
Effect<(props: P) => Effect<Element.Element, ERender, Scope.Scope | Lifecycle.Service>, EAcquire, R>
```

Returns `Effect<Component.Component<P, ERender>, EAcquire, R>`. Yield that
factory before using its returned tag in JSX. `Component.Component<P, E>`
means application dependencies have already been acquired; only the instance's
scope/lifecycle requirements remain.

```tsx
const Profile = Component.make(
  Effect.gen(function* () {
    const users = yield* Users
    return (props: { readonly id: string }) =>
      Effect.gen(function* () {
        const user = yield* Resource.make(users.get(props.id))
        return <Async.View source={user} success={(value) => <h1>{value.name}</h1>} />
      })
  })
)
```

Here `Users` is an application-defined service exposing a closed `get` action.
Service reads belong in acquisition, while props-dependent state/resources and
selectors belong in the returned renderer. Acquiring a factory once and mounting
its tag twice gives two instance scopes, not two service acquisitions.

### `Component.local(renderer)` / `Component.sync(renderer)`

- `local` is a pure declaration for a renderer with only
  `Scope.Scope | Lifecycle.Service` requirements. It returns a closed tag;
  it does not execute the renderer during declaration.
- `sync` is a pure declaration for `(props: P) => Element.Element`.
- Both run their renderer once per mount. Signals, not rerenders, drive updates.
- Render Effects must complete synchronously. Acquisition can be async, but
  asynchronous DOM initialization must use `Async.View`.

`Component.Local` names the instance environment; `Component.Render<P, E>`
names the scoped renderer type. Do not introduce application service reads in
`local` or the renderer returned by `make`.

## Application and mounting

### `Application.make<R>()(assembly)`

Declares an explicit service contract. The assembly Effect returns
`Element.ElementChild` and may require `R | Scope.Scope | Lifecycle.Service`.
The result is `Application.Application<E, R>`.

```tsx
const App = Application.make<Users>()(
  Effect.gen(function* () {
    const ProfileView = yield* Profile
    return <ProfileView id="ada" />
  })
)
```

Ordinary JSX descriptors do not preserve a tree-wide `R` union. This API solves
that gap by requiring dependency acquisition before JSX and an explicit assembly
contract. There is no claim of automatic whole-tree dependency inference.

### Scoped ownership

`Application.mount(app, container, options?)` is `Mount.scoped`:

```ts
Effect<Mount.Mounted, EApp | Mount.MountError, R | Scope.Scope>
```

- Provide application services through normal Effect composition.
- The surrounding scope owns DOM, assembly resources, and component subtrees.
- A mounted handle exposes `container` and `close: Effect<void, MountError>`.
- Leaving the scope automatically tears down the mount. Yield `close` for early
  teardown; close is idempotent.
- Only the mounted DOM range is removed; existing container siblings survive.

`Mount.layer(app, container, options?)` / `Application.layer` return a
`Layer.effectDiscard`-style layer whose lifetime owns the mount.

### Promise boundary

`Application.start(app, container, services, options?)` / `Mount.start` accept
a closed `Layer<R, ELayer>` and asynchronously return `Promise<Mount.Running>`.
Unlike the old imperative mount, startup supports async service layers and
assembly. `Running` exposes `container`, a `close` Effect, and
`dispose(): Promise<void>`.

```tsx
const running = await Application.start(App, container, UsersLayer)
// Host teardown:
await running.dispose()
```

Await disposal so in-flight event/load fibers, instance finalizers, and owned
service-layer releases finish. Failed initial mounting also awaits rollback.
Do not place acquired tags outside their owning application's lifetime.

`Mount.Options` has `onError?: (cause: unknown) => void` for uncaught runtime
failures. Root props are supplied explicitly in assembly JSX, not through mount
options. There is no public runtime handle to drive event actions manually.

## Lifecycle and actions

- `Lifecycle.onMount(action)` registers an Effect after DOM insertion and binds
  its requirements from the registering context. Use `Effect.sync` for native
  synchronous side effects or `Effect.promise` for promise work.
- `Lifecycle.onCleanup(action)` registers a finalizer in the current scope. Its
  expected error channel must be `never`; recover/log expected failures before
  registration. Defects remain defects.
- Lifecycle APIs accept **Effects, not callbacks**. Returning an Effect from an
  unexecuted JavaScript callback is not registration.
- Instance `Effect.acquireRelease`, `Effect.addFinalizer`, `Effect.forkScoped`,
  and reactive subscriptions share the component's subtree lifetime.

```tsx
const Panel = Component.local(() =>
  Effect.gen(function* () {
    yield* Lifecycle.onMount(Effect.sync(() => console.info("mounted")))
    yield* Lifecycle.onCleanup(Effect.promise(() => releasePanel()))
    return <section>Panel</section>
  })
)
```

`releasePanel` above is an application-defined Promise operation. Use
`Effect.tryPromise` plus explicit error handling instead when rejection is an
expected failure. Cleanup failures are not descendant error-boundary UI.

`Action.bind(effect)` acquires the Effect's environment now and returns a
closed Effect with the same success/error types. It **does not run the action**.
Use it while acquiring a component/assembling an application, before an Effect
enters a DOM event prop, `Async.View`, or a route loader:

```ts
const save = yield * Action.bind(Users.use((users) => users.save()))
const goHome = yield * Action.bind(Navigation.navigate("/"))
```

## Signals

### Types and constructors

- `Signal.Source<A>` is a branded, covariant read-only reactive protocol.
  It exposes `get: Effect<A>`, `changes: Stream<A>`, `.value`, and can be yielded.
- `Signal.Writable<A>` extends Source with `set(value)` and `update(f)` Effects.
  `Signal.make(initial)` returns `Effect<Writable<A>>`.
- `Signal.readonly(source)` produces a read-only facade, with no write methods
  at runtime.
- `Signal.fromSource({ get, changes, value })` adapts an external, closed source.
  Supply a live getter for `value`, not a stale snapshot. An arbitrary object
  with a `.value` property is not a Source.

`Signal.get`, `Signal.changes`, `Signal.set`, and `Signal.update` also expose
module-level access. `set`/`update` support data-first and pipeable forms.

### Selectors

- `Signal.map(source, f)` / `source.pipe(Signal.map(f))` return a scoped
  `Effect<Source<B>>`. Derived sources are read-only.
- `Signal.memo(dependencies, select, equals = Object.is)` requires at least one
  explicit dependency. It caches the selection and emits only changed results.
  Its subscriptions are owned by the current scope.
- Use `.value` for deliberate synchronous snapshots (including memo selectors),
  not as an automatically tracked dependency mechanism.

```ts
const count = yield * Signal.make(0)
const doubled = yield * Signal.map(count, (n) => n * 2)
const label = yield * Signal.memo([count], () => `Count: ${count.value}`)
const snapshot = yield * doubled
yield * count.update((n) => n + 1)
```

Signal change streams include the initial value and subsequent writes. DOM
bindings coalesce writes in a microtask, apply the latest value per binding,
and defer re-entrant updates to another flush. Initial DOM values are
synchronous, and disposed bindings cancel queued updates.

## Element, JSX, events, and controls

`Element.Element` is a descriptor, not a DOM node.
`Element.ElementChild` accepts descriptors, arrays, text/scalars, empty values,
and scalar Sources. `Element.ElementProps`, `Element.Reactive<A>`,
`Element.EventHandler<E, Target>`, `Element.ClassValue`, and
`Element.IntrinsicElementProps<T>` describe JSX contracts. `Element.Fragment`
is the fragment marker.

- Intrinsic HTML/SVG props are element-specific. Native scalar properties retain
  their type inside `Source<A>` (`disabled` needs a boolean source).
- `data-*`, `aria-*`, and custom-element attributes remain extensible.
- `class`/`className` accept strings, nested arrays, and conditional maps.
- `style` accepts CSS text or an object; numeric values become pixels except for
  unitless properties. CSS custom properties are supported.
- `value`, `checked`, and `selected` bind to live DOM properties. Use
  `defaultValue`/`defaultChecked` for uncontrolled inputs. Controlled values are
  restored after an uncanceled native form reset.
- Event props accept closed Effects (`R = never`) or native callbacks returning
  void/a closed Effect. Native events have a concrete typed `currentTarget`.
  Capture needed values before starting async work.
- Callback throws and Effect failures go to the nearest boundary or `onError`.
  Running event Effects are interrupted on element disposal. Browser defaults
  are not automatically prevented.

### `Show.View` / `For.View`

- `Show.View` accepts `when: boolean | Source<boolean>`, `children`, and optional
  `fallback`. Entering/exiting a branch mounts/disposes that subtree.
- `For.View` accepts `each: ReadonlyArray<A> | Source<ReadonlyArray<A>>`, a child
  renderer, and optional `keyOf` (default: item identity).
- Reordering retained keys moves their DOM/scopes. Removing a row disposes it.
  Replacing an item object with the same key remounts its row so snapshot props
  stay current; use immutable item updates.
- Failed replacement rows are removed/reported; later valid updates can recreate
  them. Choose stable, unique keys.
- `Show.view(props)` and `For.view(props)` are descriptor-builder forms.

### `ErrorBoundary.View`

Scopes descendant render, event Effect, and reactive-update failures.
`fallback` accepts static content or `(cause, reset) => ElementChild`.
Calling `reset()` disposes and recreates descendants. A fallback failure reaches
an outer boundary/mount handler. Cleanup failure handling remains with disposal,
not the boundary. `ErrorBoundary.view(props)` is the descriptor-builder form.

### `Transition.start(effect)`

Yields an action to a lower-priority scheduler turn while preserving its success,
failure, environment, and interruption behavior. This is scheduling, not a DOM
animation or automatic deferred reactive rendering.

## Resources and async content

`Resource.make(load)` returns a scoped `Effect<Resource.Resource<A, E>, never,
R | Scope.Scope>`. The resource starts the load in an owned fiber; a load failure
is state, not an acquisition failure.

`Resource.Resource<A, E>` exposes:

- `state: Signal.Source<Resource.ResourceState<A, E>>` and `changes`.
- `refresh: Effect<void>`: interrupts the active load and restarts it.
- `cancel: Effect<void>`: interrupts the load and leaves cancelled state.
- `Resource.refresh(resource)` / `Resource.cancel(resource)` module forms.

States are `pending`, `success`, `failure`, or `cancelled`. Success has `value`;
failure has `cause: Cause<E>`; non-success states carry
`previous: Option<A>` for the last successful value. State is read-only.

### `Async.View`

```tsx
<Async.View
  source={resourceOrClosedEffect}
  pending={<p role="status">Loading…</p>}
  success={(value) => <ProfileCard user={value} />}
  failure={(cause) => <p role="alert">Could not load the profile.</p>}
/>
```

- `source` is `Resource<A, E> | Effect<A, E, never>`.
- `success: (A) => ElementChild` is required; `pending` and `failure` are optional.
- `failure` receives the full typed `Cause<E>`, including defects; interruption-only causes are suppressed,
  not just a squashed error.
- Successful data is mapped to DOM; keep query loaders data-first.
- During Resource refresh the last successful **DOM instance** remains mounted,
  preserving local edits/state until a changed successful result replaces it.
- Removing the async subtree interrupts its own pending initialization. A shared
  cache Resource remains owned by the cache's scope, not an individual consumer.
- `Async.view(source, { success, pending?, failure? })` is the builder form.

## Resource cache

`ResourceCache.key(id, { identify, load, staleTime? })` is an inert callable query
definition. `identify(args)` returns a stable string; `load(args)` returns a
data Effect. `staleTime` is an Effect duration input (default zero).

```ts
const UserQuery = ResourceCache.key("user", {
  identify: (id: string) => id,
  load: (id) => Users.use((users) => users.get(id)),
  staleTime: "5 minutes"
})
```

- `UserQuery(args)` / `ResourceCache.get(UserQuery, args)` return an Effect
  requiring `ResourceCache.Cache | RLoader`; loader failures appear in Resource
  state. Defining or constructing a query Effect does not run the loader.
- `ResourceCache.layer` provides a scope-owned Cache service, never a global
  cache. Identical query/identified arguments share pending work and cached state.
- Completed entries are reused until stale, then revalidated. Zero stale time
  deduplicates in-flight work only.
- `ResourceCache.bind(query)` acquires Cache and loader requirements and returns
  `(args) => Effect<Resource<A, E>>` with a closed environment. Bind during
  component acquisition; invoke it inside instance rendering.
- `ResourceCache.invalidate(query, args)` removes/cancels one entry.
  `ResourceCache.clear` removes/cancels all owned entries.
- `ResourceCache.make()` explicitly creates a local scoped cache with
  `get(query, args)`, `invalidate(query, args)`, and `clear`; it does not provide
  the Cache service. Its `get` still needs loader services, so close those first
  when using a local cache inside `Component.local`.
- Cache scope owns its resources until invalidation/clear or scope teardown.
  Individual views should not assume removing one consumer cancels shared work.

## HTTP

- `Http.layer(options?)` provides Effect's Fetch client. `fetch` injects a
  Fetch-compatible transport; `requestInit` supplies browser defaults;
  `configureClient` applies client middleware once when the layer builds.
- `Http.json(request, schema)` requires the provided HTTP client, rejects
  non-success statuses, and decodes JSON with Schema. Decoder service
  requirements, when present, are part of the Effect environment.
- `Http.withBaseUrl(client, url)` prepends an absolute base URL.
- `Http.throughBff(client, prefix)` prefixes request URLs with a non-root,
  same-origin BFF path. A server must implement the BFF; rewriting cannot bypass
  CORS or act as a transparent browser network proxy.
- `Http.HttpClient`, `Http.HttpClientRequest`, `Http.HttpClientResponse`,
  `Http.HttpClientError`, and `Http.FetchHttpClient` re-export Effect modules.
- Use `HttpClient.mapRequest`, `transformResponse`, `retryTransient`, and
  `HttpClientResponse.schemaBodyJson` for lower-level composition. Use
  ResourceCache for shared query ownership/staleness, not a second global cache.

```ts
const HttpLayer = Http.layer({
  requestInit: { credentials: "include" },
  configureClient: (client) =>
    Http.throughBff(client, "/bff").pipe(
      Http.HttpClient.mapRequest(Http.HttpClientRequest.setHeader("x-app", "web"))
    )
})
```

## Forms, refs, and focus

- `Form.make({ initial, validate, onSubmit })` captures validation/submission
  requirements and returns `Form.FormState<A, Issue, EValidation, ESubmit>`.
  For per-instance forms, acquire services/closed actions first and create the
  form inside the renderer.
- `values` is writable; `errors` and `submitting` are read-only Sources.
- Validators return user-facing issues as data. Failed validation/submission
  Effects retain their typed failures and reach runtime error handling.
- `submit` and `reset` are closed Effects; `onSubmit` prevents native form
  navigation and runs validation before submission. Duplicate active submissions
  are ignored. `Form.submit(form)` / `Form.reset(form)` expose module forms.
- `Form.field(values, key)` is scoped and returns `Form.FormField<A[K]>`:
  read-only `.value` plus immutable `set`/`update` actions preserving other fields.

```tsx
const Contact = Component.local(() =>
  Effect.gen(function* () {
    const form = yield* Form.make({
      initial: { email: "" },
      validate: ({ email }) => Effect.succeed(email.includes("@") ? [] : ["Enter an email"]),
      onSubmit: ({ email }) => Effect.sync(() => console.info("Contact request", email))
    })
    const email = yield* Form.field(form.values, "email")
    return (
      <form onSubmit={form.onSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          value={email.value}
          onInput={(event) => email.set(event.currentTarget.value)}
        />
        <button disabled={form.submitting}>Save</button>
      </form>
    )
  })
)
```

`Ref.make<T extends Node>()` returns `Ref.RefObject<T>` with `current: T | null`.
Callback refs receive the element on mount and null on disposal; object refs are
also cleared. Refs are assigned after insertion.

`Focus.focus(ref): Effect<boolean>` reports successful focus;
`Focus.blur(ref): Effect<boolean>` reports whether an active element was blurred;
`Focus.first(containerRef): Effect<HTMLElement | null>` focuses the first
sequentially focusable descendant. These do not implement focus traps or restore
focus automatically.

## Images

- `Image.View` is a closed native-image tag; `Image.make(props)` returns an
  Effect producing its descriptor.
- `Image.ImageProps` requires `src`, `alt`, `width`, and `height`. Use meaningful
  alternative text or `alt=""` for decoration; dimensions reserve layout space.
- Native loading defaults to `lazy`. `decode` waits for native decode before
  invoking `onLoad`. Load/decode failure invokes `onError` and displays accessible
  default/custom `fallback` content.
- Image callbacks preserve the native Event's getters, methods, setters, and
  image `currentTarget` after asynchronous decode.
- `Image.preload(src, options?)` returns
  `Effect<HTMLImageElement, Image.ImageLoadError>`; decode defaults to true.
  Options include cross-origin/referrer policy/fetch priority. It uses the native
  loader and browser HTTP cache, not an application byte cache/build plugin.

## Router, routes, links, and navigation

### Acquisition and adapters

- `Router.make(options)` acquires `Navigation.Service` and returns a closed
  outlet tag. `Router.Options` describes ordered routes, `notFound`, hooks, and
  optional `scrollRestoration: "auto" | "manual"`.
- `Link.make()` acquires navigation and returns a closed anchor tag with
  `Link.Props`.
- `Navigation.browserLayer` owns browser URL listeners in its layer scope;
  `Navigation.memoryLayer(initial = "/")` provides deterministic location state.
- `Navigation.navigate(path, { replace? })` and `Navigation.prefetch(path)` are
  service-requiring Effects. Bind them before event JSX with `Action.bind`.
- `Navigation.Provider` exposes a read-only `location` and closed
  `navigate`/`prefetch` actions. Invalid/cross-origin programmatic destinations
  fail with `Navigation.NavigationError`. Memory navigation does not manipulate
  browser history, and memory prefetch is a no-op.

### Route declarations

`Route.make(path, options)` is pure and returns `Router.RouteDefinition`.
Absolute root paths and relative child paths support `:name` parameters; a
trailing slash does not change matching. The first ordered match wins.
`Router.RouteLocation` includes `params`, `pathname`, `search`, and `hash`.

Each route has at most one page handler:

- `render(location) => ElementChild` for synchronous content.
- `load(location) => Effect<ElementChild, unknown, never>` for async content.
  Acquire services or bind Effects before constructing this closure.
- `lazy() => Promise<{ default: (location) => ElementChild }>` for imported
  modules. Imports are deduplicated per router, can be prefetched, and failed
  imports can be retried via route error reset.
- A handler-free parent must declare `children`.

Routes also support `layout(location, child)`, `pending`, `error(cause, reset)`,
`notFound`, `metadata`, and nested `children`. Leaving a loaded/lazy route
interrupts the render continuation; native dynamic imports themselves cannot be
canceled. Route error UI covers render/event/reactive/loader failures.

Metadata may be static or resolved from location. Parent fields are inherited,
deeper fields override title/description individually, and prior document values
are restored when absent or when the router is disposed.

Navigation hooks receive `{ from, to, kind }`; `kind` is `navigate`, `popstate`,
or `hashchange`. Hooks are synchronous; throws reach boundary/mount error
handling. Browser navigation preserves `history.state` and leaves native scroll
restoration enabled unless manual control is requested.

### Acquired links

`<Anchor to replace? end? prefetch?>` retains a real `href`, updates
`data-active` for activity, and sets `aria-current="page"` on exact matches.
Pointer hover/keyboard focus prefetch lazy route modules by default; disable
with `prefetch={false}`. Modified clicks, downloads, target links, and external
destinations retain native behavior; hash-only links retain native scrolling.

For lazy modules needing acquired dependencies, wrap the imported module's
renderer in a closed location function. [`example/Directory.tsx`](../example/Directory.tsx)
passes an acquired anchor into its lazy Reports renderer without hiding a
navigation service read behind JSX. [`example/Console.tsx`](../example/Console.tsx)
is the integrated reference: nested routing with a shared layout, cached member
queries with refresh, a validating settings form, a virtualized audit trail, and
a live activity feed.

## Virtualization

- `Virtualizer.fixedRange(count, itemSize, viewportSize, scrollOffset, overscan)`
  is pure fixed-size geometry: `start`, `end`, `offset`, `totalSize`.
- `VirtualList.make(options)` returns a scoped `VirtualList.VirtualList<A>`
  controller. It exposes read-only visible `rows`, range, active-index state,
  total size, listbox/option attributes, scroll/resize actions, and
  Arrow/Home/End/page keyboard handling.
- `VirtualTable.make(options)` returns a scoped
  `VirtualTable.VirtualTable<Row, Column>` controller with two-axis windows,
  grid/row/cell attributes, active-cell state, and two-axis keyboard actions.
- Controllers require unique string or finite-number keys and snapshot input
  arrays. Recreate them when data/key sets change.
- Hosts own the scroll element, absolute positioning at `start`, viewport
  observations, and applying scroll offsets returned by keyboard actions.
- Controllers expose read-only Sources, not mutable internal window state.
  See [`example/Virtualized.tsx`](../example/Virtualized.tsx) for complete hosts.

## Testing

- `Testing.render(appOrClosedJsx, { container?, onError? })` is an Effect
  requiring the application's services and Scope. Provide layers through Effect,
  not through render options.
- Returns `container`, `close: Effect<void, MountError>`, and pure
  `getByText(text)` / `queryByText(text)` exact-text queries.
- `Testing.fireEvent(target, event)` and `Testing.fireInput(control, value)` are
  Effects dispatching native events.
- `Testing.waitFor(assertion, { timeout?, interval? })` retries a **throwing
  assertion** until it succeeds; default timeout is 1000 ms and interval 10 ms.
  Returning `false` or `null` is not failure. Timeout fails with
  `Testing.WaitForError`.
- Leaving the test scope automatically awaits teardown. Yield `view.close` for
  explicit early teardown. There is no global `cleanup()` registry or `unmount`
  Promise method in the canonical API.

```tsx
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const view = yield* Testing.render(App)
      yield* Testing.fireEvent(
        view.container.querySelector("button")!,
        new MouseEvent("click", { bubbles: true, cancelable: true })
      )
      yield* Testing.waitFor(() => view.getByText("Saved"))
    })
  ).pipe(Effect.provide(UsersLayer))
)
```

Use a DOM-capable test environment. These text helpers are small conveniences,
not a complete accessible-role query library; Happy DOM is not evidence of
real-browser compatibility. See [BROWSERS.md](BROWSERS.md).
