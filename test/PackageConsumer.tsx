import {
  Async,
  Image,
  Resource,
  ResourceCache,
  defineComponent,
  createRef,
  createForm,
  focusFirst,
  Link,
  ErrorBoundary,
  For,
  Show,
  Signal,
  startTransition,
  mount,
  Navigate,
  Router,
  type ClassValue,
  type RouteDefinition,
  type RefCallback
} from "@effect/ui"
import { Context, Effect, Layer } from "effect"
import { cleanup, fireEvent, fireInput, render, waitFor } from "@effect/ui/testing"

interface Task {
  readonly id: number
  readonly label: string
}

const TaskLabel = defineComponent((props: { readonly label: string }) =>
  Effect.succeed(<span>{props.label}</span>)
)

const RootLabel = defineComponent((props: { readonly name: string }) => <h1>{props.name}</h1>)

// @ts-expect-error Required component props are checked for package consumers.
const MissingLabel = <TaskLabel />

// @ts-expect-error Mounting a props-driven root requires its props.
mount(RootLabel, document.createElement("div"), Layer.empty)

const visible = Effect.runSync(Signal.make(true))

const App = defineComponent(() =>
  Effect.succeed(
    <main>
      <Show when={visible} fallback={<p>Empty</p>}>
        <TaskLabel label="ready" />
      </Show>
      <For each={[{ id: 1, label: "one" } satisfies Task]} keyOf={(task: Task) => task.id}>
        {(task: Task) => <TaskLabel label={task.label} />}
      </For>
    </main>
  )
)

const ResourceApp = defineComponent(() =>
  Effect.gen(function* () {
    const resource = yield* Resource.make(Effect.succeed(<p>Loaded</p>))

    return <Async resource={resource} fallback={<p>Loading</p>} />
  })
)

const CachedKey = ResourceCache.key(
  "consumer-profile",
  (id: string) => id,
  (id: string) => Effect.succeed(<p>{id}</p>),
  "5 minutes"
)

const CachedApp = defineComponent(() =>
  Effect.gen(function* () {
    const cache = yield* ResourceCache.make()
    const profile = yield* cache.get(CachedKey, "ada")

    return <Async resource={profile} fallback={<p>Loading</p>} />
  })
)

const ImageApp = defineComponent(() => (
  <Image src="/logo.svg" alt="Logo" width={120} height={40} loading="eager" />
))

const PreloadImage = Image.preload("/hero.webp", { fetchPriority: "high" })

mount(App, document.createElement("div"), Layer.empty)

mount(ResourceApp, document.createElement("div"), Layer.empty)

mount(CachedApp, document.createElement("div"), Layer.empty)

mount(ImageApp, document.createElement("div"), Layer.empty)

void PreloadImage

mount(RootLabel, document.createElement("div"), Layer.empty, { props: { name: "Ada" } })

const Classes: ClassValue = ["button", { active: true }]

const TypedButtonRef: RefCallback<HTMLButtonElement> = (button) => {
  if (button !== null) button.disabled = false
}

const Routes: ReadonlyArray<RouteDefinition> = [
  {
    path: "/",
    render: () => (
      <button class={Classes} style={{ color: "red" }}>
        Home
      </button>
    )
  }
]

const RouteApp = <Router routes={Routes} fallback={<p>Missing</p>} />

const NestedRoutes: ReadonlyArray<RouteDefinition> = [
  {
    path: "/users",
    layout: (_location, child) => <section>{child}</section>,
    notFound: (location) => <p>No user route at {location.pathname}</p>,
    children: [
      {
        path: ":id",
        load: ({ params }) => Effect.succeed(<p>User {params.id}</p>),
        pending: <p>Loading user</p>,
        error: (cause, reset) => <button onClick={() => reset()}>{String(cause)}</button>
      }
    ]
  }
]

const NestedRouteApp = (
  <Router
    routes={NestedRoutes}
    notFound={<p>Missing route</p>}
    onBeforeNavigate={({ from, to, kind }) => void [from, to, kind]}
    onAfterNavigate={({ from, to, kind }) => void [from, to, kind]}
    scrollRestoration="manual"
  />
)

const HomeLink = (
  <Link to="/" end aria-label="Home page">
    Home
  </Link>
)

const AsyncContent = <Async effect={Effect.succeed(<p>Loaded</p>)} fallback={<p>Loading</p>} />

const TransitionAction = startTransition(Effect.succeed(undefined))

const FormState = createForm({
  initial: { email: "" },
  validate: (values) => Effect.succeed(values.email.includes("@") ? [] : ["Enter an email"]),
  onSubmit: (values) => Effect.sync(() => console.log(values.email))
})

const FocusAction = focusFirst(createRef<HTMLElement>())

const TestingApi = [render(<p>test view</p>), fireEvent, fireInput, waitFor, cleanup]

class TestLabel extends Context.Service<TestLabel, { readonly value: string }>()("TestLabel") {}

const ServiceLayer = Layer.succeed(TestLabel, TestLabel.of({ value: "from layer" }))

const ServiceComponent = defineComponent(() =>
  Effect.gen(function* () {
    const service = yield* TestLabel

    return <p>{service.value}</p>
  })
)

const ServiceRenderedView = render(<ServiceComponent />, { layer: ServiceLayer })

const RecoverableContent = (
  <ErrorBoundary
    fallback={(cause, reset) => <button onClick={() => reset()}>{String(cause)}</button>}
  >
    <p>Ready</p>
  </ErrorBoundary>
)

const TypedDom = (
  <>
    <label htmlFor="email">Email</label>
    <input
      id="email"
      type="email"
      required
      autoComplete="email"
      value="ada@example.com"
      ref={createRef<HTMLInputElement>()}
    />
    <button
      type="submit"
      disabled
      data-state="ready"
      aria-pressed={false}
      ref={TypedButtonRef}
      onClick={(event) => {
        const buttonCode: number = event.button
        void buttonCode
      }}
    >
      Continue
    </button>
    <input
      onInput={(event) => {
        const inputValue: string = event.currentTarget.value
        const inputType: string = event.inputType
        void [inputValue, inputType]
      }}
      onCompositionEnd={(event) => {
        const composedText: string = event.data
        const targetValue: string = event.currentTarget.value
        void [composedText, targetValue]
      }}
    />
    <svg viewBox="0 0 20 20" role="img">
      <circle cx={10} cy={10} r={8} fill="tomato" />
    </svg>
    <app-status data-state="ready" custom-property="accepted" />
  </>
)

// @ts-expect-error `href` is not a native button property.
const InvalidButtonAttribute = <button href="/unsupported" />

// @ts-expect-error `rows` is not a native input property.
const InvalidInputAttribute = <input rows={3} />

// @ts-expect-error Ref element types must agree with their native tag.
const InvalidInputRef = <input ref={createRef<HTMLDivElement>()} />

// @ts-expect-error Raw markup sinks are deliberately not part of the JSX API.
const RawHtmlSink = <div innerHTML="<img src=x onerror=alert(1)>" />

const Navigation = Navigate("/home")

void [
  RouteApp,
  NestedRouteApp,
  HomeLink,
  AsyncContent,
  TransitionAction,
  FormState,
  FocusAction,
  TestingApi,
  ServiceRenderedView,
  RecoverableContent,
  TypedDom,
  InvalidButtonAttribute,
  InvalidInputAttribute,
  InvalidInputRef,
  RawHtmlSink,
  Navigation
]

void MissingLabel
