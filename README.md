# @effect/ui

A client-side JSX UI library with **Effect-powered components** and
**fine-grained signals**. Components run once to build their tree; signals update
the DOM bindings that use them, without rerendering the component.

```tsx
import { defineComponent, mount } from "@effect/ui"
import { Effect } from "effect"

const CounterView = defineComponent(() =>
  Effect.gen(function* () {
    const counter = yield* Counter
    return <button onClick={counter.increment}>Count: {counter.count}</button>
  })
)

const app = mount(CounterView, document.querySelector("#app")!, Counter.layer)

// Later, typically when the containing application unmounts:
await app.dispose()
```

Built on Effect v4. This project currently targets the browser DOM; server
components and server rendering are intentionally out of scope.

## Composition

Create a component from a synchronous props-to-JSX function and compose it like
any JSX tag:

```tsx
const Greeting = defineComponent((props: { name: string }) => <p>Hello, {props.name}!</p>)

const Page = defineComponent(() => (
  <main>
    <Greeting name="Ada" />
  </main>
))
```

Use an Effect-returning renderer when a component needs services, scoped setup,
or other Effect operations. The root component is mounted with the services
supplied by its `Layer`; nested components share that runtime. Each component
also gets its own Effect scope, so `Signal.map`, `Effect.forkScoped`, and
finalizers are disposed when that component's subtree is removed.

## Signals and control flow

```tsx
const visible = yield * Signal.make(true)
const label = yield * Signal.make("ready")

return (
  <section class={label}>
    <Show when={visible} fallback={<p>Hidden</p>}>
      <p>{label}</p>
    </Show>
    <For each={todos} keyOf={(todo: Todo) => todo.id}>
      {(todo: Todo) => <TodoRow todo={todo} />}
    </For>
  </section>
)
```

- `class` and `className` accept strings, nested arrays, and conditional maps.
  A `Signal` can update the full class value without a component rerun.
- `style` accepts CSS text or a property object, and either form can use a
  `Signal`. Numeric values become pixels except for unitless properties; custom
  properties such as `--accent` are supported.
- Signal change streams emit the initial value and every write in order.
  Reactive DOM bindings batch writes in a microtask and apply only the latest
  value per binding; re-entrant writes run in the next flush. Initial DOM values
  are synchronous, and disposing a subtree cancels any queued binding updates.
- `startTransition(effect)` yields to the Effect scheduler at lower priority
  before running the action. Its error, environment, and interruption behavior
  are preserved; this schedules work but does not animate DOM changes.
- `Signal.memo(dependencies, select, equals?)` caches an expensive derived
  value, recomputes only when one of the explicit signals changes, and emits
  only when its equality predicate reports a changed result. Its subscriptions
  are interrupted with the surrounding Effect scope.
- Common form properties (`value`, `checked`, and `selected`) bind to the live
  DOM property, so a signal update controls the input without a component rerun.
- The renderer rejects script elements, SVG SMIL animation elements, and
  `iframe srcdoc`.
- It rejects `javascript:` and `vbscript:` URL schemes. It blocks `data:` URLs
  in embedded document elements.
- Raw markup/content sinks (`innerHTML`, `outerHTML`, and `textContent`) are not
  supported; render child nodes instead.
- `Show.when` accepts a boolean or `Signal<boolean>`. Its active branch is
  mounted on entry and disposed on exit.
- `For.each` accepts an array or `Signal<ReadonlyArray<A>>`. `keyOf` defaults to
  item identity. Reorders move existing keyed subtrees; removed rows dispose
  their scopes. Replacing an item's object while retaining its key remounts that
  row so its snapshot props stay current; prefer immutable item updates.
  If a replacement row fails to render, the row is removed and reported through
  `onError`; a later valid update can recreate it.

## Routing

`Router` reads the browser path and renders the first matching route. Root route
paths start with `/`; nested child paths are relative. `:name` segments capture
path parameters, and trailing slashes do not change a match. Each route receives
`params`, `pathname`, `search`, and `hash`. Use `notFound` for global unmatched
paths (`fallback` remains as a deprecated alias). Nested routes can add layouts,
route-local error UI, and not-found views for unmatched descendants.

```tsx
import { defineComponent, Router, type RouteDefinition } from "@effect/ui"

const Routes: ReadonlyArray<RouteDefinition> = [
  { path: "/", render: () => <Home /> },
  {
    path: "/users",
    layout: (_location, child) => <UserLayout>{child}</UserLayout>,
    notFound: <NotFound />,
    children: [
      {
        path: ":id",
        load: ({ params }) =>
          api.loadUser(params.id).pipe(Effect.map((user) => <User user={user} />)),
        pending: <p>Loading user…</p>,
        error: (cause) => <p>Could not load user: {String(cause)}</p>
      }
    ]
  },
  {
    path: "/reports",
    lazy: () => import("./routes/Reports.js"),
    pending: <p>Loading reports…</p>,
    error: (cause) => <p>Could not load reports: {String(cause)}</p>
  }
]

const App = defineComponent(() => (
  <Router
    routes={Routes}
    notFound={<NotFound />}
    onBeforeNavigate={({ from, to }) => console.log("Navigating", from.pathname, to.pathname)}
  />
))
```

`RouteDefinition.lazy` can dynamically import a module whose default export
renders the matched page; its `pending` view appears during import, nested
layouts still wrap it, and leaving the route cancels the render
continuation. Lazy imports are deduplicated per router, and a failed import can
be retried through route error UI reset.

`Link` renders a semantic anchor, updates `data-active` and `aria-current="page"`
as the URL changes, and supports `end` matching and replace navigation. By
default it prefetches matching lazy modules on pointer hover or keyboard focus;
set `prefetch={false}` to opt out. Modified clicks, downloads, target links, and external destinations keep browser
behavior. Hash-only links keep native scrolling. `Navigate("/users/42")` returns
an `Effect` for programmatic navigation; pass it directly to an event prop or
yield it from another Effect. Use `{ replace: true }` to replace the current
history entry. Router navigation preserves the current `history.state` value.

Route `load` functions return a closed Effect that produces route content. The
route's `pending` view appears while it runs; leaving the route interrupts the
loader, and router disposal also cancels it. A route `error` boundary handles
its render, event, reactive-update, and loader failures. `onBeforeNavigate` and
`onAfterNavigate` receive `{ from, to, kind }`; hook exceptions are reported
through the nearest error boundary or mount-level `onError`. Native browser
scroll restoration is left enabled by default; `scrollRestoration="manual"`
opts into manual browser control while that router is mounted.

Matched routes can contribute document metadata. Parent values are inherited,
and deeper routes override individual fields. A missing value restores what was
in the document before the router mounted; disposing a router also restores its
previous values.

```tsx
{
  path: "/members/:id",
  metadata: ({ params }) => ({
    title: `Member ${params.id} — Directory`,
    description: `Profile information for ${params.id}.`
  }),
  render: ({ params }) => <Member id={params.id} />
}
```

## Large collections

`VirtualList.make` and `VirtualTable.make` are headless, scope-owned controllers
for fixed-size data. They render only visible items plus `overscan`, require
stable unique string or finite-number keys, and expose listbox/grid ARIA
attributes and keyboard navigation. The host owns the scrollable element and
positions each item at its `start` offset; pass browser scroll values to
`onScroll`, viewport changes to `resize`, and apply returned keyboard scroll
offsets to the element. `Virtualizer.fixedRange` is also available as a pure
fixed-size geometry helper.

```tsx
const people =
  yield *
  VirtualList.make({
    id: "people",
    ariaLabel: "People",
    items,
    keyOf: (person) => person.id,
    itemSize: 44,
    viewportSize: 220,
    overscan: 3
  })

return (
  <div {...people.attributes} onScroll={(event) => people.onScroll(event.currentTarget.scrollTop)}>
    <div style={{ height: `${people.totalSize}px`, position: "relative" }}>
      <For each={people.rows} keyOf={(row) => row.key}>
        {(row) => (
          <div
            {...people.optionAttributes(row)}
            style={{ position: "absolute", top: `${row.start}px` }}
          >
            {row.item.name}
          </div>
        )}
      </For>
    </div>
  </div>
)
```

Collections are snapshotted when a controller is created. Recreate it in the
owning scope when the collection or its key set changes. `example/Virtualized.tsx`
demonstrates a keyboard-accessible list and a two-dimensional virtual grid,
including resize observation and scroll synchronization.

## Images

`Image` renders a native `<img>` and defaults to browser-native lazy loading.
It requires meaningful `alt` text (or `alt=""` for decoration) and intrinsic
`width`/`height` to reserve layout space. An accessible fallback is shown after
a load or optional decode failure; pass `fallback` for application-specific
error UI. `Image.preload(src, options)` returns an Effect that preloads and
optionally decodes with the browser image loader and HTTP cache. It does not
maintain a separate byte cache or require a build tool.

```tsx
import { Image } from "@effect/ui"

;<Image
  src="/images/hero.webp"
  alt="A mountain at sunrise"
  width={1280}
  height={720}
  loading="lazy"
  decode
  fallback={<p role="status">Image unavailable</p>}
/>
```

## Asynchronous subtrees

Use `<Async>` to initialize a subtree from a closed Effect without blocking
`mount()`. The fallback is shown while the Effect runs; an optional `error`
renderer provides local failure UI. Pending work is interrupted when the async
subtree is removed.

```tsx
<Async
  effect={Effect.map(api.loadProfile(userId), (profile) => (
    <Profile profile={profile} />
  ))}
  fallback={<p>Loading profile…</p>}
  error={(cause) => <p>Could not load profile: {String(cause)}</p>}
/>
```

For work that needs explicit refresh/cancel state, create an Effect-native
`Resource` in an Effect component and pass it to `<Async>`. It exposes
`pending`, `success`, `failure`, and `cancelled` states. Refresh interrupts the
previous load, and `<Async>` keeps the last successful subtree visible while a
refresh is pending.

```tsx
import { Async, Resource, ResourceCache, defineComponent } from "@effect/ui"
import { Effect } from "effect"

const Profile = defineComponent((props: { userId: string }) =>
  Effect.gen(function* () {
    const profile = yield* Resource.make(
      Effect.map(api.loadProfile(props.userId), (user) => <ProfileCard user={user} />)
    )

    return (
      <Async
        resource={profile}
        fallback={<p>Loading profile…</p>}
        error={(cause) => <p role="alert">Could not load profile: {String(cause)}</p>}
      />
    )
  })
)
```

Use `ResourceCache` when multiple views should share a request or its result.
Create it in a long-lived component scope and share it with descendants; it is
not global. `ResourceCache.key(id, identify, load, staleTime)` binds a stable
loader to a key. The same key and identified arguments share in-flight work;
completed entries are reused until stale and then refreshed. The default stale
time is zero, so only in-flight work is deduplicated unless you set a duration.
`invalidate(key, args)` and `clear` remove entries and interrupt their active
loads.

```tsx
const ProfileKey = ResourceCache.key(
  "profile",
  (id: string) => id,
  (id: string) => Effect.map(api.loadProfile(id), (user) => <ProfileCard user={user} />),
  "5 minutes"
)

const CachedProfile = defineComponent((props: { cache: ResourceCache; userId: string }) =>
  Effect.gen(function* () {
    const resource = yield* props.cache.get(ProfileKey, props.userId)

    return <Async resource={resource} fallback={<p>Loading profile…</p>} />
  })
)
```

## HTTP requests

The `@effect/ui/http` entry point exposes Effect's HTTP client modules, while
`Http` provides a browser Fetch layer and small URL helpers. This keeps request
transforms, response transforms, retries, status handling, and schema decoding
on Effect's existing HTTP implementation instead of maintaining a second
transport API.

```tsx
import { Http, ResourceCache } from "@effect/ui"
import { HttpClient, HttpClientRequest } from "@effect/ui/http"
import { Schema } from "effect"

const Profile = Schema.Struct({ id: Schema.String, name: Schema.String })

const ProfileKey = ResourceCache.key(
  "profile",
  (id: string) => id,
  (id) => Http.json(HttpClientRequest.get(`/users/${id}`), Profile),
  "1 minute"
)

const HttpLayer = Http.browserLayer({
  requestInit: { credentials: "include" },
  configureClient: (client) =>
    Http.throughBff(client, "/bff").pipe(
      HttpClient.mapRequest(HttpClientRequest.setHeader("x-app", "web"))
    )
})
```

`Http.json(request, schema)` uses the configured client, requires a successful
status, and decodes the JSON body. Provide `HttpLayer` where the query Effect
runs. Configure shared request/response middleware once with
`HttpClient.mapRequest` and `HttpClient.transformResponse`; use
`HttpClient.retryTransient` for Effect-managed retries. The scope-owned
`ResourceCache` shares in-flight queries and provides stale-time/revalidation;
there is no competing global data cache. `Http.throughBff` prefixes relative
browser URLs with a same-origin BFF path. It cannot bypass CORS or create a
transparent network proxy; the BFF must run server-side. `browserLayer` accepts
a custom Fetch-compatible transport for tests/adapters. See `example/Http.tsx`
for a deterministic demo.

## Error boundaries

`<ErrorBoundary>` catches descendant render failures, event Effect failures, and
reactive DOM-update failures. Its `fallback` can be static content or a builder
receiving the failure and a `reset()` action. Reset disposes and recreates the
descendant subtree. Errors raised by the fallback itself are sent to an outer
boundary or the mount-level `onError` handler.

```tsx
<ErrorBoundary
  fallback={(cause, reset) => (
    <section role="alert">
      <p>{String(cause)}</p>
      <button onClick={() => reset()}>Try again</button>
    </section>
  )}
>
  <Profile />
</ErrorBoundary>
```

## Forms and accessibility

Use `value`/`checked` with Signals for controlled fields, or
`defaultValue`/`defaultChecked` for native uncontrolled fields. Controlled
fields restore their Signal value after an uncanceled native form reset.
`onInput` and composition callbacks receive native events with the concrete
input element as `currentTarget`.

`createForm` provides controlled values, validation issues, submitting state,
reset, and an `onSubmit` callback that prevents native navigation. Use
`Form.field(form.values, "email")` for a reactive field signal with safe `set`
and `update` actions instead of repeating immutable object updates. The
validator returns user-facing issues as data; failed validation/submission
Effects remain typed and propagate to an enclosing boundary or `onError`.

```tsx
const ContactForm = defineComponent(() =>
  Effect.gen(function* () {
    const form = yield* createForm({
      initial: { email: "" },
      validate: ({ email }) => Effect.succeed(email.includes("@") ? [] : ["Enter an email"]),
      onSubmit: (values) => api.save(values)
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
        <button type="submit" disabled={form.submitting}>
          Save
        </button>
      </form>
    )
  })
)
```

`focus(ref)`, `blur(ref)`, and `focusFirst(containerRef)` provide focus
management for mounted HTML elements. The library does not impose a focus trap
or replace native keyboard behavior; use semantic HTML, labels, and ARIA where
appropriate.

## Lifecycle and events

Yield lifecycle effects from a component:

```tsx
const Panel = defineComponent(() =>
  Effect.gen(function* () {
    yield* onMount(() => console.log("mounted"))
    yield* onCleanup(() => console.log("removed"))
    return <section>...</section>
  })
)
```

`onMount` callbacks run after the initial tree (or a dynamically inserted
subtree) is in place; `onCleanup` runs when the subtree is disposed. Both may
return promises. `dispose()` waits for pending mount callbacks before it runs
cleanup callbacks. Event props accept closed Effects (`R = never`), so expose
ready-to-run actions from services and pass them directly, e.g.
`onClick={counter.increment}`. They also accept native-event callbacks typed for
their event (for example, `onClick={(event) => ...}`); callbacks may return
`void` or a closed Effect. Synchronous callback failures and Effect failures go
to the nearest enclosing `<ErrorBoundary>` or, if unhandled, `onError`. Running
callback Effects are interrupted when their element is disposed. Native
default behavior is not prevented automatically.

Native HTML and SVG tags have element-specific props. `data-*`, `aria-*`, and
custom-element attributes remain extensible. `createRef<HTMLInputElement>()`
creates an object ref; callback refs receive the native element when mounted
and `null` when their subtree is disposed. Refs are assigned after insertion of
their element and are cleared during disposal.

`mount` returns a handle with an asynchronous `dispose()`. Await it when the
application is shutting down so Effect finalizers (including asynchronous
resource releases) have completed. The renderer removes only the DOM range it
mounted; sibling content in the container is left intact. An optional fourth
argument, `{ onError }`, receives uncaught errors from lifecycle callbacks,
event handlers, and reactive DOM updates. Props-driven root components receive
props through that same argument: `mount(App, container, layer, { props: { name:
"Ada" } })`.

## Develop and build

```bash
bun install
bun run dev          # browser demo: state, routing, resources, and virtualization
bun run typecheck
bun run lint         # Oxlint with the better-antislop plugin rules
bun run format       # Oxfmt write
bun run format:check # Oxfmt check, no writes
bun run test
bun run test:browser   # requires a running Vite server and W3C WebDriver
bun run bench:runtime  # deterministic coalescing checks plus timing output
bun run ci             # sequential local CI gate
bun run build:lib    # ESM package + declarations in dist/
bun run typecheck:package # verify exports/declarations as a NodeNext consumer
bun run build        # library build and Vite demo build
```

The package exports its built ESM entrypoints and TypeScript declarations from
`dist/`, including the JSX runtimes and `@effect/ui/testing`.

The testing subpath exports `render`, `fireEvent`, `fireInput`, `waitFor`, and
`cleanup`. A rendered view exposes scoped text queries and an awaitable `unmount`;
`cleanup()` disposes all remaining views and waits for Effect finalizers.

The package remains private while the API is being developed.

GitHub Actions checks pushes and pull requests. A published GitHub Release is
the only publishing trigger, and its workflow refuses to publish while
`package.json` is private or its tag does not match the package version. Before
the first public release, configure npm trusted publishing for the release
workflow, add the canonical source/issue URLs to package metadata, and explicitly
remove the private-package guard in `package.json`. See
[`docs/RELEASING.md`](docs/RELEASING.md).

See [`docs/API.md`](docs/API.md) for the API index,
[`docs/MIGRATION.md`](docs/MIGRATION.md) for the pre-1.0 migration policy,
[`docs/ACCESSIBILITY_AND_SECURITY.md`](docs/ACCESSIBILITY_AND_SECURITY.md) for
application guidance, and [`docs/BROWSERS.md`](docs/BROWSERS.md) for the browser
matrix and WebDriver smoke instructions. The browser demo in `example/` covers
signals, forms, routing and lazy routes, metadata, resources/cache, images,
focus, transitions, and virtualized lists and grids.

## Current boundaries

- Browser DOM only; no server components or SSR.
- Component render Effects are synchronous; asynchronous subtree initialization
  uses `<Async>`. `<ErrorBoundary>` handles descendant render, event Effect, and
  reactive DOM-update failures; lifecycle cleanup errors still follow disposal
  and mount-level error handling.
- JSX props cover native scalar DOM properties and common SVG attributes; this
  is not a complete mapping of every browser-specific DOM property or event.
