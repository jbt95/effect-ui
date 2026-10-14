import { Cause, Context, Data, Effect, Layer, SubscriptionRef } from "effect"
import { describe, expect, it, vi } from "vitest"
import {
  Application,
  Async,
  Component,
  Lifecycle,
  Link,
  Mount,
  Navigation,
  Resource,
  ResourceCache,
  Router,
  Signal,
  Testing
} from "../src/Index.js"
import { DeferredPromise } from "./DeferredPromise.js"

class Label extends Context.Service<Label, { readonly text: string }>()("test/Label") {}

class LoadError extends Data.TaggedError("LoadError")<{ readonly message: string }> {}

describe("Effect-native public interfaces", () => {
  it("acquires async Layers once and allocates state and lifecycle per mounted instance", async () => {
    let acquisitions = 0
    let mounts = 0
    const cleanups: Array<string> = []
    const container = document.createElement("div")

    const services = Layer.effect(
      Label,
      Effect.gen(function* () {
        yield* Effect.sleep(1)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            cleanups.push("service")
          })
        )

        return { text: "Count" }
      })
    )

    const factory = Component.make(
      Effect.gen(function* () {
        const label = yield* Label
        acquisitions += 1

        return () =>
          Effect.gen(function* () {
            const count = yield* Signal.make(0)
            yield* Lifecycle.onMount(
              Effect.sync(() => {
                mounts += 1
              })
            )
            yield* Lifecycle.onCleanup(
              Effect.sync(() => {
                cleanups.push("instance")
              })
            )

            return (
              <button onClick={count.update((value) => value + 1)}>
                {label.text}: {count}
              </button>
            )
          })
      })
    )

    const app = Application.make<Label>()(
      Effect.gen(function* () {
        const View = yield* factory

        return (
          <>
            <View />
            <View />
          </>
        )
      })
    )

    const running = await Mount.start(app, container, services)

    try {
      expect(acquisitions).toBe(1)
      await vi.waitFor(() => expect(mounts).toBe(2))
      container.querySelector("button")!.click()
      await vi.waitFor(() => expect(container.textContent).toBe("Count: 1Count: 0"))
    } finally {
      await running.dispose()
    }

    await running.dispose()
    expect(cleanups).toEqual(["instance", "instance", "service"])
    expect(container.childNodes).toHaveLength(0)
  })

  it("recognizes adapted readable sources and exposes selectors without write operations", async () => {
    const container = document.createElement("div")
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ref = yield* SubscriptionRef.make("first")

          const source = Signal.fromSource({
            get: SubscriptionRef.get(ref),
            changes: SubscriptionRef.changes(ref),
            get value() {
              return SubscriptionRef.getUnsafe(ref)
            }
          })

          const length = yield* source.pipe(Signal.map((value: string) => value.length))
          expect("set" in length).toBe(false)
          expect(yield* length).toBe(5)

          const view = yield* Testing.render(
            <>
              <p>{source}</p>
              <output>{length}</output>
            </>,
            { container }
          )

          yield* SubscriptionRef.set(ref, "updated")
          yield* Testing.waitFor(() => expect(view.container.textContent).toBe("updated7"))
        })
      )
    )
    expect(container.childNodes).toHaveLength(0)
  })

  it("renders data resources and keeps the successful DOM instance through refresh", async () => {
    const gate = DeferredPromise<{ readonly name: string }>()
    const started = DeferredPromise()
    let loads = 0
    let mounts = 0
    let cleanups = 0

    const Profile = Component.local((props: { readonly name: string }) =>
      Effect.gen(function* () {
        yield* Lifecycle.onMount(
          Effect.sync(() => {
            mounts += 1
          })
        )
        yield* Lifecycle.onCleanup(
          Effect.sync(() => {
            cleanups += 1
          })
        )

        return <input defaultValue={props.name} />
      })
    )

    const app = Application.make()(
      Effect.gen(function* () {
        const resource = yield* Resource.make(
          Effect.suspend(() => {
            loads += 1

            if (loads === 1) return Effect.succeed({ name: "Ada" })
            started.resolve()

            return Effect.promise(() => gate.promise)
          })
        )

        return (
          <>
            <button onClick={resource.refresh}>Refresh</button>
            <Async.View
              source={resource}
              pending={<p>Loading</p>}
              success={(user) => <Profile name={user.name} />}
            />
          </>
        )
      })
    )

    const container = document.createElement("div")
    const running = await Mount.start(app, container, Layer.empty)

    try {
      await vi.waitFor(() => expect(mounts).toBe(1))
      const input = container.querySelector("input")!
      input.value = "Local edit"
      container.querySelector("button")!.click()
      await started.promise
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(container.querySelector("input")).toBe(input)
      expect(input.value).toBe("Local edit")
      expect(cleanups).toBe(0)
      gate.resolve({ name: "Grace" })
      await vi.waitFor(() => expect(container.querySelector("input")?.value).toBe("Grace"))
      expect(mounts).toBe(2)
      expect(cleanups).toBe(1)
    } finally {
      await running.dispose()
    }

    expect(cleanups).toBe(2)
  })

  it("passes full typed causes to async failure views", async () => {
    const failure = new LoadError({ message: "Unavailable" })
    let observed: Cause.Cause<LoadError> | undefined
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const view = yield* Testing.render(
            <Async.View
              source={Effect.fail(failure)}
              success={() => <p>Ready</p>}
              failure={(cause) => {
                observed = cause

                return <p>Unavailable</p>
              }}
            />
          )

          yield* Testing.waitFor(() => expect(view.getByText("Unavailable")).toBeDefined())
          expect(Cause.squash(observed!)).toBe(failure)
        })
      )
    )
  })

  it("keeps cache acquisition scoped and callable query definitions inert", async () => {
    let loads = 0

    const query = ResourceCache.key("label", {
      identify: (id: string) => id,
      load: (id) =>
        Effect.sync(() => {
          loads += 1

          return id
        }),
      staleTime: "1 minute"
    })

    const acquisition = query("ada")
    expect(loads).toBe(0)
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const first = yield* acquisition
          const duplicate = yield* ResourceCache.get(query, "ada")
          expect(first).toBe(duplicate)
          yield* Testing.waitFor(() => expect(first.state.value.status).toBe("success"))
          expect(loads).toBe(1)
          yield* ResourceCache.invalidate(query, "ada")
          const replacement = yield* query("ada")
          expect(replacement).not.toBe(first)
        }).pipe(Effect.provide(ResourceCache.layer))
      )
    )
  })

  it("uses replaceable memory navigation for outlets and acquired links", async () => {
    const app = Application.make<Navigation.Service>()(
      Effect.gen(function* () {
        const Outlet = yield* Router.make({
          routes: [
            { path: "/", render: () => <p>Home</p> },
            { path: "/about", render: () => <p>About page</p> }
          ]
        })

        const Anchor = yield* Link.make()

        return (
          <>
            <Anchor to="/about">About</Anchor>
            <Outlet />
          </>
        )
      })
    )

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const view = yield* Testing.render(app)
          expect(view.getByText("Home")).toBeDefined()
          yield* Testing.fireEvent(
            view.container.querySelector("a")!,
            new MouseEvent("click", { bubbles: true, cancelable: true })
          )
          yield* Testing.waitFor(() => expect(view.getByText("About page")).toBeDefined())
          expect(view.container.querySelector("a")?.getAttribute("aria-current")).toBe("page")
        }).pipe(Effect.provide(Navigation.memoryLayer()))
      )
    )
  })

  it("awaits failed initial-render rollback before releasing service Layers", async () => {
    const gate = DeferredPromise()
    const started = DeferredPromise()
    let released = false
    let settled = false

    const Child = Component.local(() =>
      Effect.gen(function* () {
        yield* Lifecycle.onCleanup(
          Effect.promise(() => {
            started.resolve()

            return gate.promise
          })
        )

        return <p>Partial</p>
      })
    )

    const Broken = Component.sync(() => {
      throw new Error("Render failed")
    })

    const app = Application.make<Label>()(
      Effect.gen(function* () {
        yield* Label

        return (
          <>
            <Child />
            <Broken />
          </>
        )
      })
    )

    const services = Layer.effect(
      Label,
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            released = true
          })
        )

        return { text: "Label" }
      })
    )

    const result = Mount.start(app, document.createElement("div"), services, {
      onError: () => {}
    }).catch((error) => {
      settled = true

      return error
    })

    await started.promise

    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(settled).toBe(false)
      expect(released).toBe(false)
    } finally {
      gate.resolve()
    }

    await result
    expect(settled).toBe(true)
    expect(released).toBe(true)
  })
})
