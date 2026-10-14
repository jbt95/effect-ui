# Migration to the Effect-native namespace API

`@effect/ui` is private and pre-1.0. Breaking changes may occur between 0.x
releases; this guide describes the current redesign, not a stable 0.x upgrade
guarantee. The 1.0 policy will use semantic versioning once 1.0.0 is published.
SSR/hydration remain separate product decisions.

## Import and naming changes

Root imports are real module namespaces. Types are namespace members, not flat
root exports. Same-name module subpaths are also exported:

```ts
import { Component, Element, Signal, Testing } from "@effect/ui"
import * as Resource from "@effect/ui/Resource"

type Props = { readonly name: string }
type View = Component.Component<Props>
type Children = Element.ElementChild
type Count = Signal.Source<number>
```

Deprecated flat interfaces are isolated at `@effect/ui/legacy` for staged
compatibility. Do not mix legacy tags/runtime handles with new application
assembly, and do not use legacy imports for new code.

| Previous interface                              | Canonical interface                                            |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `defineComponent` with application requirements | Yield `Component.make(acquire)`                                |
| Pure/scoped local `defineComponent`             | `Component.sync` / `Component.local`                           |
| `mount(component, container, layer)`            | Await `Application.start(app, container, layer)`               |
| Root props in mount options                     | Explicit props in assembly JSX                                 |
| `Component<P, E, R>`                            | `Component.Component<P, E>` after acquisition                  |
| Writable `Signal<A>` everywhere                 | `Signal.Writable<A>` for state; `Signal.Source<A>` for readers |
| `createRef`, `focus`, `blur`, `focusFirst`      | `Ref.make`, `Focus.focus`, `Focus.blur`, `Focus.first`         |
| Callback `onMount` / `onCleanup`                | `Lifecycle.onMount(effect)` / `Lifecycle.onCleanup(effect)`    |
| `createForm`                                    | `Form.make`                                                    |
| `startTransition`                               | `Transition.start`                                             |
| JSX `Show`, `For`, `ErrorBoundary`, `Image`     | `Show.View`, `For.View`, `ErrorBoundary.View`, `Image.View`    |
| `Async effect/resource fallback error`          | `Async.View source success pending failure`                    |
| Positional `ResourceCache.key` arguments        | `key(id, { identify, load, staleTime })`                       |
| Ambient JSX `Router` / `Link`                   | Yield `Router.make(options)` / `Link.make()`                   |
| `Navigate`                                      | `Navigation.navigate` (bind before events)                     |
| `Http.browserLayer`                             | `Http.layer`                                                   |
| Promise test helpers/global cleanup             | Scoped `Testing` Effects / `view.close`                        |

## 1. Separate acquisition from instance rendering

Move service reads out of props renderers. `Component.make` acquires a renderer
and returns a dependency-closed JSX tag:

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

`Users` above is an application-defined Effect service with closed methods.
Keep Signals, resources, selectors, refs, lifecycle registration, and forked
fibers **inside** the returned renderer when they are per-instance. Allocating
them during factory acquisition shares them across every instance of that tag.
Shared state may intentionally belong to an application service/layer.

Use `Component.local` when no application services are needed and
`Component.sync` for pure JSX. Neither declares hidden application dependencies.
Do not yield a service inside a local renderer or use assertions to erase `R`.

## 2. Declare and assemble the application

```tsx
const App = Application.make<Users>()(
  Effect.gen(function* () {
    const ProfileView = yield* Profile
    return (
      <main>
        <ProfileView id="ada" />
      </main>
    )
  })
)
```

The explicit `Application.make<R>()` contract checks acquired factory/service
requirements. JSX does not infer an environment from arbitrary descendants;
closed acquired tags plus explicit assembly are the dependency boundary.
`Component.make(...)` is an Effect, not a tag: yield it before writing JSX.

For several dependencies use a union such as
`Application.make<Users | Navigation.Service | ResourceCache.Cache>()`.
Required props stay checked on acquired tags. Supply root props in JSX instead
of imperative mount options.

## 3. Choose an owned startup boundary

Imperative browser hosts now await asynchronous startup:

```tsx
const running = await Application.start(App, container, UsersLayer)
// When the host removes the application:
await running.dispose()
```

The handle has `container`, `close` (Effect), and `dispose` (Promise adapter),
not a public runtime. The supplied closed layer must provide the full explicit
contract. Async layers are supported; synchronous component rendering is not
changed into async rendering.

Effect hosts can instead yield `Application.mount` / `Mount.scoped` inside a
long-lived scope and provide layers normally:

```ts
const program = Effect.scoped(
  Effect.gen(function* () {
    const mounted = yield* Mount.scoped(App, container)
    yield* waitForHostShutdown
    yield* mounted.close
  })
).pipe(Effect.provide(UsersLayer))
```

`waitForHostShutdown` is a host-owned Effect. Do not immediately finish the owning
scope after mounting unless immediate teardown is intended. A mount layer is
also available as `Mount.layer` / `Application.layer`.

Await teardown, including failed startup rollback. Instance finalizers run while
application services remain alive; application-layer releases finish before
Promise disposal resolves. Register host/page cleanup, but do not rely on a
browser awaiting async finalizers when terminating a document.

## 4. Register lifecycle Effects directly

```ts
yield * Lifecycle.onMount(Effect.sync(() => observer.observe(element)))
yield * Lifecycle.onCleanup(Effect.sync(() => observer.disconnect()))
```

Wrap Promise work in `Effect.promise` (or `tryPromise` for expected rejection).
Do not pass callbacks returning Effects; do not return a cleanup callback from
`onMount`. Register release separately with `Lifecycle.onCleanup` or use normal
scoped Effect resource acquisition. Cleanup's expected error channel must be
`never`: handle expected failure explicitly before registration.

## 5. Close actions before JSX

Events and Async sources accept closed Effects. Service accessor Effects such
as `Navigation.navigate("/")` still need a service; capture their requirements
during setup:

```tsx
const HomeButton = Component.make(
  Effect.gen(function* () {
    const home = yield* Action.bind(Navigation.navigate("/"))
    return () => Effect.succeed(<button onClick={home}>Home</button>)
  })
)
```

Prefer already-acquired service methods when they are closed. Native event
callbacks may return void or closed Effects; their typed `currentTarget` remains
available. Do not run async service acquisition in an instance renderer or use a
separate unmanaged runtime to bypass the environment contract.

## 6. Separate async data from UI

Replace Element-producing loads with data loads plus `success`:

```tsx
<Async.View
  source={loadUser}
  pending={<p role="status">Loading…</p>}
  success={(user) => <ProfileCard user={user} />}
  failure={(cause) => <p role="alert">Could not load the profile.</p>}
/>
```

`loadUser` must be a closed Effect or Resource. `failure` receives `Cause<E>`,
not a plain error. `Resource.make` owns per-instance refresh/cancel work;
`Async.View` retains the last successful DOM during Resource refresh, preserving
local state/edits until changed data succeeds. Do not change a loader to return
JSX solely to adapt to the async view.

## 7. Bind cached queries and HTTP

```tsx
const UserQuery = ResourceCache.key("user", {
  identify: (id: string) => id,
  load: (id) => Http.json(Http.HttpClientRequest.get(`/users/${id}`), UserSchema),
  staleTime: "1 minute"
})

const Profile = Component.make(
  Effect.gen(function* () {
    const lookup = yield* ResourceCache.bind(UserQuery)
    return (props: { readonly id: string }) =>
      Effect.gen(function* () {
        const user = yield* lookup(props.id)
        return <Async.View source={user} success={(value) => <h1>{value.name}</h1>} />
      })
  })
)
```

Provide `ResourceCache.layer` and `Http.layer()` and declare
`ResourceCache.Cache | Http.HttpClient.HttpClient` in the application contract.
A query is an inert callable definition; calling it yields an Effect requiring
Cache and loader services. Bind that query during acquisition before using it
in a closed instance renderer. A shared cache owns its resource lifetimes;
removing one consumer does not necessarily cancel shared work.

`ResourceCache.make()` remains the explicit local-cache option. It does not
provide the Cache service or silently close an open loader. `invalidate` and
`clear` remove/cancel entries; default stale time remains zero.

Use HTTP modules under `Http.HttpClient` / `Http.HttpClientRequest` /
`Http.HttpClientResponse`, or their direct module imports. `Http.layer` is the
canonical browser Fetch layer name. BFF URL rewriting remains a server-backed
same-origin helper, not a proxy/CORS workaround.

## 8. Acquire router outlets and anchors

```tsx
const App = Application.make<Navigation.Service>()(
  Effect.gen(function* () {
    const Anchor = yield* Link.make()
    const Outlet = yield* Router.make({
      routes: [Route.make("/", { render: () => <p>Home</p> })],
      notFound: <p>Page not found</p>
    })
    return (
      <>
        <Anchor to="/" end>
          Home
        </Anchor>
        <Outlet />
      </>
    )
  })
)
```

Use `Navigation.browserLayer` in the browser and `Navigation.memoryLayer(initial)`
in tests. Replace deprecated router `fallback` with `notFound`. Route declarations
remain pure; async route loaders must return closed Effects, so acquire/bind
loader services before creating their closures. Lazy route modules export a
closed location renderer; pass acquired tags through a wrapper when needed
(see the Directory/Reports demo).

Layouts, pending/error UI, metadata, active links, intent prefetching, and native
modified/external/hash click behavior remain available.

## 9. Read-only state and forms

- Replace read-side `Signal<A>` annotations with `Signal.Source<A>`; retain
  `Signal.Writable<A>` only where writes are needed.
- `Signal.map` / `Signal.memo` results have no setters at runtime. Write to
  source state, not selectors.
- Use `Signal.fromSource` for an external closed reactive source; `.value`
  shape alone is not the protocol.
- Reactive native props retain scalar types. Fix incorrect source types rather
  than asserting a string source into a boolean prop.
- Use `Form.make` and `Form.field`; `form.values` is writable, while `errors`,
  `submitting`, and field `.value` are read-only. Bind submission dependencies
  first, then allocate per-instance form state inside rendering.
- Use `Ref.make<T>` with the tag's concrete native element type.

## 10. Make tests scoped

```tsx
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const view = yield* Testing.render(App)
      yield* Testing.fireInput(view.container.querySelector("input")!, "Ada")
      yield* Testing.waitFor(() => view.getByText("Hello, Ada"))
      yield* view.close // optional early teardown
    })
  ).pipe(Effect.provide(TestServices))
)
```

Test helpers are Effects; exact-text queries are pure. Provide layers through
Effect rather than `render` options. Scope exit awaits automatic teardown;
remove global `cleanup()` hooks and Promise `unmount()` calls.
`waitFor` retries thrown assertions, not false/null results.

## Validation checklist

1. Update imports/contracts, acquire all dependency-bearing factories before JSX.
2. Run typecheck, package-consumer checks, lint, and relevant tests.
3. Re-test route changes, loaders, cache ownership, boundary reset, form
   submission, instance reuse, failed startup, and awaited disposal.
4. Run the real-browser smoke harness on supported engines, especially native
   image decode callbacks and event receiver behavior.
5. Review raw HTML/URL safety, accessible names, focus, keyboard behavior, and
   error-message redaction. See [API.md](API.md),
   [ACCESSIBILITY_AND_SECURITY.md](ACCESSIBILITY_AND_SECURITY.md), and
   [BROWSERS.md](BROWSERS.md).
