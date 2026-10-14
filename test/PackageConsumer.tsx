import {
  Application,
  Async,
  Component,
  Element,
  Action,
  Form,
  For,
  Image,
  Lifecycle,
  Mount,
  Navigation,
  Ref,
  Resource,
  ResourceCache,
  Router,
  Route,
  Show,
  Signal,
  Testing
} from "@effect/ui"
import * as SignalModule from "@effect/ui/Signal"
import * as MountModule from "@effect/ui/Mount"
import { Cause, Context, Data, Effect, Layer } from "effect"

class MissingUser extends Data.TaggedError("MissingUser")<{ readonly id: string }> {}

class Users extends Context.Service<
  Users,
  { readonly get: (id: string) => Effect.Effect<{ readonly name: string }, MissingUser> }
>()("consumer/Users") {}

class Other extends Context.Service<Other, { readonly name: string }>()("consumer/Other") {}

const UsersLayer = Layer.succeed(Users, { get: () => Effect.succeed({ name: "Ada" }) })

const Profile = Component.make(
  Effect.gen(function* () {
    const users = yield* Users

    return (props: { readonly id: string }) =>
      Effect.gen(function* () {
        const user = yield* Resource.make(users.get(props.id))
        yield* Lifecycle.onMount(Effect.void)
        yield* Lifecycle.onCleanup(Effect.void)

        return (
          <Async.View
            source={user}
            pending={<p>Loading</p>}
            success={(value) => <h1>{value.name}</h1>}
            failure={(cause) => {
              const typed: Cause.Cause<MissingUser> = cause

              return <p>{Cause.pretty(typed)}</p>
            }}
          />
        )
      })
  })
)

// @ts-expect-error Dependency acquisition cannot run without Users.
Effect.runSync(Profile)

// @ts-expect-error A local renderer cannot introduce application services behind JSX.
Component.local(() => Users.pipe(Effect.map(() => <p>Unbound</p>)))

// @ts-expect-error The explicit application contract rejects an undeclared dependency.
Application.make<Users>()(Other.pipe(Effect.map(() => <p>Wrong contract</p>)))

const App = Application.make<Users>()(
  Effect.gen(function* () {
    const ProfileView = yield* Profile
    // @ts-expect-error Props remain checked after acquiring a component factory.
    const MissingProps = <ProfileView />
    void MissingProps

    return <ProfileView id="ada" />
  })
)

// @ts-expect-error The application still needs Users when mounted.
Effect.runPromise(Effect.scoped(Mount.scoped(App, document.createElement("div"))))

// @ts-expect-error The Promise adapter also rejects an incomplete service Layer.
Mount.start(App, document.createElement("div"), Layer.empty)

Mount.start(App, document.createElement("div"), UsersLayer)

const Scoped = MountModule.scoped(App, document.createElement("div")).pipe(
  Effect.provide(UsersLayer)
)

const Contracts = Effect.gen(function* () {
  const count = yield* SignalModule.make(0)
  const derived = yield* count.pipe(Signal.map((value: number) => value * 2))
  const snapshot: number = yield* derived
  void snapshot
  // @ts-expect-error Derived values expose no setters.
  derived.set(1)
  const wrong = yield* Signal.make("not a boolean")
  // @ts-expect-error Reactive native attributes retain their scalar value type.
  const BadBoolean = <button disabled={wrong} />
  // @ts-expect-error An arbitrary value getter is not a signal source.
  const FakeSource = <p>{{ value: "fake" }}</p>
  // @ts-expect-error Expected cleanup failures must be handled before registering a finalizer.
  yield* Lifecycle.onCleanup(Effect.fail(new MissingUser({ id: "ada" })))
  // @ts-expect-error Lifecycle actions are Effects, not callbacks that can silently return Effects.
  yield* Lifecycle.onMount(() => Effect.void)

  const unbound = Users.use((users) => users.get("ada"))
  // @ts-expect-error An open-environment async operation must be bound before entering JSX.
  const UnboundAsync = Async.view(unbound, { success: (user) => <p>{user.name}</p> })

  const action = yield* Action.bind(Users.use((users) => users.get("ada")))
  const ValidAsync = <Async.View source={action} success={(user) => <p>{user.name}</p>} />

  const form = yield* Form.make({
    initial: { email: "" },
    validate: () => Effect.succeed([]),
    onSubmit: () => Effect.void
  })

  const email = yield* Form.field(form.values, "email")

  const nodes = (
    <>
      <input value={email.value} onInput={(event) => email.set(event.currentTarget.value)} />
      <Show.View when={true}>
        <p>{derived}</p>
      </Show.View>
      <For.View each={[{ id: 1, name: "Ada" }]} keyOf={(item) => item.id}>
        {(item) => <p>{item.name}</p>}
      </For.View>
    </>
  )

  // @ts-expect-error Internal form flags are read-only.
  form.submitting.set(false)
  const refs = <input ref={Ref.make<HTMLInputElement>()} />
  // @ts-expect-error Ref element types still agree with the tag.
  const BadRef = <input ref={Ref.make<HTMLDivElement>()} />
  // @ts-expect-error Raw HTML remains prohibited.
  const RawHtml = <div innerHTML="<script>alert(1)</script>" />
  void [BadBoolean, FakeSource, UnboundAsync, ValidAsync, nodes, refs, BadRef, RawHtml]
})

const Query = ResourceCache.key("user", {
  identify: (id: string) => id,
  load: (id) => Users.use((users) => users.get(id)),
  staleTime: "1 minute"
})

const Queries = Effect.gen(function* () {
  const lookup = yield* ResourceCache.bind(Query)
  const result = yield* lookup("ada")

  return <Async.View source={result} success={(user) => <p>{user.name}</p>} />
})

const Routes = Router.make({ routes: [Route.make("/", { render: () => <p>Home</p> })] })

const ImageNode = <Image.View src="/hero.webp" alt="Hero" width={640} height={360} />

const TestProgram = Effect.gen(function* () {
  const view = yield* Testing.render(App)
  yield* Testing.fireEvent(view.container, new Event("click"))
  yield* Testing.waitFor(() => view.getByText("Ada"))
})

void [
  Scoped,
  Contracts,
  Queries,
  Routes,
  ImageNode,
  TestProgram,
  Navigation.browserLayer,
  Element.Fragment
]
