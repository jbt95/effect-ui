import { Effect, Layer } from "effect"
import {
  Application,
  Component,
  Focus,
  Image,
  Link,
  Navigation,
  Ref,
  Route,
  Router,
  Signal
} from "../../src/Index.js"

const SearchRef = Ref.make<HTMLInputElement>()

const AppContainer = document.querySelector<HTMLElement>("#app")!

const Result = document.querySelector<HTMLOutputElement>("#result")!

const Routes = [
  Route.make("/test/browser", { render: () => <p id="route-content">home</p> }),
  Route.make("/about", {
    load: () =>
      Effect.promise(
        () =>
          new Promise<JSX.Element>((resolve) => {
            setTimeout(() => resolve(<p id="route-content">about loaded</p>), 40)
          })
      ),
    pending: <p id="route-pending">loading about</p>
  })
] satisfies ReadonlyArray<Router.RouteDefinition>

const CounterView = Component.local(() =>
  Effect.gen(function* () {
    const Counter = yield* Signal.make(0)

    return (
      <button id="increment" onClick={Counter.update((value) => value + 1)}>
        Count: {Counter}
      </button>
    )
  })
)

const App = Application.make<Navigation.Service>()(
  Effect.gen(function* () {
    const Anchor = yield* Link.make()
    const Outlet = yield* Router.make({ routes: Routes, notFound: <p>missing route</p> })

    return (
      <section>
        <CounterView />
        <input ref={SearchRef} aria-label="Search" />
        <Anchor to="/about" id="about-link">
          About
        </Anchor>
        <Outlet />
      </section>
    )
  })
)

const waitFor = async (Predicate: () => boolean): Promise<void> => {
  const Deadline = Date.now() + 3000

  while (!Predicate()) {
    if (Date.now() >= Deadline) throw new Error("Timed out waiting for browser DOM update")

    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const CheckImageCallback = async (DecodeFails: boolean): Promise<void> => {
  const Container = document.createElement("div")
  let CallbackTarget: HTMLImageElement | undefined
  let Failure: unknown

  const CaptureTarget = (
    EventValue: Event & { readonly currentTarget: HTMLImageElement }
  ): void => {
    // Exercise browser-native getters and methods, not just Happy DOM's Event implementation.
    EventValue.returnValue = false
    EventValue.cancelBubble = true
    EventValue.preventDefault()

    if (!(EventValue instanceof Event) || EventValue.currentTarget.localName !== "img") {
      throw new Error("Image callback lost its native event or image target")
    }

    CallbackTarget = EventValue.currentTarget
  }

  const ImageApp = Application.make()(
    Effect.succeed(
      <Image.View
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E"
        alt="Smoke test image"
        width={1}
        height={1}
        loading="eager"
        decode
        onLoad={DecodeFails ? undefined : CaptureTarget}
        onError={DecodeFails ? CaptureTarget : undefined}
      />
    )
  )

  const Handle = await Application.start(ImageApp, Container, Layer.empty, {
    onError: (Error) => {
      Failure = Error
    }
  })

  try {
    const ImageElement = Container.querySelector("img")!

    if (DecodeFails)
      ImageElement.decode = () => Promise.reject(new Error("Expected decode failure"))

    await waitFor(() => CallbackTarget !== undefined || Failure !== undefined)

    if (Failure !== undefined) throw Failure

    if (CallbackTarget !== ImageElement)
      throw new Error("Image callback did not preserve currentTarget")
  } finally {
    await Handle.dispose()
  }
}

const RunSmokeTest = async (): Promise<void> => {
  let Dispose: (() => Promise<void>) | undefined

  try {
    await CheckImageCallback(false)
    await CheckImageCallback(true)

    const Handle = await Application.start(App, AppContainer, Navigation.browserLayer)
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

    const Focused = await Effect.runPromise(Focus.focus(SearchRef))

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
