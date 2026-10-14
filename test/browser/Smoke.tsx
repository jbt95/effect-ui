import { Effect, Layer } from "effect"
import { createRef, defineComponent, focus, Link, mount, Router, Signal } from "../../src/Index.js"
import type { RouteDefinition } from "../../src/Index.js"

const Counter = Effect.runSync(Signal.make(0))

const SearchRef = createRef<HTMLInputElement>()

const AppContainer = document.querySelector<HTMLElement>("#app")!

const Result = document.querySelector<HTMLOutputElement>("#result")!

const Routes = [
  { path: "/test/browser", render: () => <p id="route-content">home</p> },
  {
    path: "/about",
    load: () =>
      Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) => {
            setTimeout(() => resolve(<p id="route-content">about loaded</p>), 40)
          })
      ),
    pending: <p id="route-pending">loading about</p>
  }
] satisfies ReadonlyArray<RouteDefinition>

const App = defineComponent(() =>
  Effect.succeed(
    <section>
      <button id="increment" onClick={Counter.update((value) => value + 1)}>
        Count: {Counter}
      </button>
      <input ref={SearchRef} aria-label="Search" />
      <Link to="/about" id="about-link">
        About
      </Link>
      <Router routes={Routes} notFound={<p>missing route</p>} />
    </section>
  )
)

const waitFor = async (Predicate: () => boolean): Promise<void> => {
  const Deadline = Date.now() + 3000

  while (!Predicate()) {
    if (Date.now() >= Deadline) throw new Error("Timed out waiting for browser DOM update")

    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const RunSmokeTest = async (): Promise<void> => {
  let Dispose: (() => Promise<void>) | undefined

  try {
    const Handle = mount(App, AppContainer, Layer.empty)
    Dispose = Handle.dispose

    if (AppContainer.textContent?.includes("home") !== true) {
      throw new Error("Router did not render the initial route")
    }

    document.querySelector<HTMLButtonElement>("#increment")!.click()
    await waitFor(() => AppContainer.querySelector("button")?.textContent === "Count: 1")

    document.querySelector<HTMLAnchorElement>("#about-link")!.click()
    await waitFor(() => AppContainer.querySelector("#route-pending") !== null)
    await waitFor(
      () => AppContainer.querySelector("#route-content")?.textContent === "about loaded"
    )

    const AboutLink = document.querySelector<HTMLAnchorElement>("#about-link")!

    if (AboutLink.dataset.active !== "true" || AboutLink.getAttribute("aria-current") !== "page") {
      throw new Error("Link active and current-page state did not update after navigation")
    }

    const Focused = await Effect.runPromise(focus(SearchRef))

    if (!Focused) throw new Error("Focus helper failed to focus its mounted input")

    await Dispose()

    if (AppContainer.childNodes.length !== 0) throw new Error("Disposal left mounted DOM behind")

    Result.dataset.status = "passed"
    Result.textContent = "passed"
  } catch (error) {
    let CleanupError: unknown

    try {
      await Dispose?.()
    } catch (cleanupError) {
      CleanupError = cleanupError
    }

    Result.dataset.status = "failed"
    const Failure = error instanceof Error ? (error.stack ?? error.message) : String(error)
    Result.textContent =
      CleanupError === undefined ? Failure : `${Failure}\nCleanup failed: ${String(CleanupError)}`
  }
}

void RunSmokeTest()
