import { Effect, Layer } from "effect"
import { describe, expect, it, vi } from "vitest"
import {
  Async,
  createRef,
  defineComponent,
  ErrorBoundary,
  mount,
  onCleanup,
  onMount,
  Resource,
  Signal,
  type ElementChild
} from "../src/Legacy.js"
import { DeferredPromise } from "./DeferredPromise.js"

describe("release lifecycle regressions", () => {
  it.each([
    { Variant: "ref", Props: { multiple: true, ref: createRef<HTMLSelectElement>() } },
    { Variant: "event", Props: { multiple: true, onChange: () => {} } },
    { Variant: "signal", Props: { multiple: Effect.runSync(Signal.make(true)) } }
  ])("initializes multiple selects on the dynamic $Variant path", async ({ Props }) => {
    const Container = document.createElement("div")

    const App = defineComponent(() => (
      <select {...Props}>
        <option selected>A</option>
        <option selected>B</option>
      </select>
    ))

    const Handle = mount(App, Container, Layer.empty)

    try {
      expect(Array.from(Container.querySelectorAll("option"), (Option) => Option.selected)).toEqual(
        [true, true]
      )
    } finally {
      await Handle.dispose()
    }
  })

  it.each([
    { Position: "sibling", Finalizer: false },
    { Position: "self", Finalizer: false },
    { Position: "sibling", Finalizer: true },
    { Position: "self", Finalizer: true }
  ])(
    "awaits failed render rollback ($Position, Effect finalizer: $Finalizer)",
    async ({ Position, Finalizer }) => {
      const Cleanup = DeferredPromise()
      let CleanupStarted = false
      let Disposed = false
      const Container = document.createElement("div")

      const StartCleanup = (): Promise<void> => {
        CleanupStarted = true

        return Cleanup.promise
      }

      const Child = defineComponent(() =>
        Effect.gen(function* () {
          if (Finalizer) yield* Effect.addFinalizer(() => Effect.promise(StartCleanup))
          else yield* onCleanup(StartCleanup)

          if (Position === "self") throw new Error("Child render failed")

          return <span>Partial child</span>
        })
      )

      const Broken = defineComponent(() => {
        throw new Error("Sibling render failed")
      })

      const App = defineComponent(() => (
        <ErrorBoundary fallback={<p>Recovered</p>}>
          <Child />
          <Broken />
        </ErrorBoundary>
      ))

      const Handle = mount(App, Container, Layer.empty)
      expect(Container.textContent).toBe("Recovered")
      await vi.waitFor(() => expect(CleanupStarted).toBe(true))

      const Disposing = Handle.dispose().then(() => {
        Disposed = true
      })

      try {
        await new Promise((Resolve) => setTimeout(Resolve, 0))
        expect(Disposed).toBe(false)
      } finally {
        Cleanup.resolve()
        await Disposing
      }
    }
  )

  it.each(["effect", "resource"] as const)(
    "awaits interrupted %s branch cleanup during disposal",
    async (Source) => {
      const Content = DeferredPromise<ElementChild>()
      const Cleanup = DeferredPromise()
      let CleanupStarted = false
      let Disposed = false
      const Errors: Array<unknown> = []
      const Container = document.createElement("div")

      const Fallback = defineComponent(() =>
        Effect.gen(function* () {
          yield* onCleanup(() => {
            CleanupStarted = true

            return Cleanup.promise
          })

          return <p>Loading</p>
        })
      )

      const App = defineComponent(() =>
        Effect.gen(function* () {
          const Load = Effect.promise(() => Content.promise)

          if (Source === "effect") return <Async effect={Load} fallback={<Fallback />} />

          const Value = yield* Resource.make(Load)

          return <Async resource={Value} fallback={<Fallback />} />
        })
      )

      const Handle = mount(App, Container, Layer.empty, { onError: (Error) => Errors.push(Error) })
      Content.resolve(<strong>Ready</strong>)
      await vi.waitFor(() => expect(CleanupStarted).toBe(true))

      const Disposing = Handle.dispose().then(() => {
        Disposed = true
      })

      try {
        await new Promise((Resolve) => setTimeout(Resolve, 0))
        expect(Disposed).toBe(false)
      } finally {
        Cleanup.resolve()
        await Disposing
      }

      expect(Container.textContent).toBe("")
      expect(Errors).toEqual([])
    }
  )

  it("preserves successful DOM and local state through refresh and cancellation", async () => {
    const Container = document.createElement("div")
    const Refresh = DeferredPromise<ElementChild>()
    let Loads = 0
    let Mounts = 0
    let Cleanups = 0
    const LoadStarted = DeferredPromise()

    const Profile = defineComponent(() =>
      Effect.gen(function* () {
        yield* onMount(() => {
          Mounts += 1
        })
        yield* onCleanup(() => {
          Cleanups += 1
        })

        return <input aria-label="Profile name" defaultValue="Ada" />
      })
    )

    const App = defineComponent(() =>
      Effect.gen(function* () {
        const Value = yield* Resource.make(
          Effect.suspend(() => {
            Loads += 1

            if (Loads === 1) return Effect.succeed(<Profile />)
            LoadStarted.resolve()

            return Effect.promise(() => Refresh.promise)
          })
        )

        return (
          <>
            <button onClick={Value.refresh}>Refresh</button>
            <button onClick={Value.cancel}>Cancel</button>
            <Async resource={Value} />
          </>
        )
      })
    )

    const Handle = mount(App, Container, Layer.empty)

    try {
      await vi.waitFor(() => expect(Mounts).toBe(1))

      const Input = Container.querySelector("input")!
      Input.value = "Edited locally"
      Container.querySelectorAll("button")[0].click()
      await LoadStarted.promise
      await new Promise((Resolve) => setTimeout(Resolve, 0))
      expect(Container.querySelector("input")).toBe(Input)
      expect(Input.value).toBe("Edited locally")
      expect(Mounts).toBe(1)
      expect(Cleanups).toBe(0)

      Container.querySelectorAll("button")[1].click()
      await new Promise((Resolve) => setTimeout(Resolve, 0))
      expect(Container.querySelector("input")).toBe(Input)
      expect(Mounts).toBe(1)
      expect(Cleanups).toBe(0)
    } finally {
      await Handle.dispose()
    }

    expect(Cleanups).toBe(1)
  })

  it("removes partially rendered siblings before the initial boundary fallback", async () => {
    const Container = document.createElement("div")

    const Broken = defineComponent(() => {
      throw new Error("Broken descendant")
    })

    const App = defineComponent(() => (
      <>
        <span>Outside</span>
        <ErrorBoundary fallback={<p>Recovered</p>}>
          <span>Partial content</span>
          <Broken />
        </ErrorBoundary>
      </>
    ))

    const Handle = mount(App, Container, Layer.empty)

    try {
      expect(Container.textContent).toBe("OutsideRecovered")
    } finally {
      await Handle.dispose()
    }
  })
})
