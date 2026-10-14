import { Application, Http, Mount, Navigation, ResourceCache } from "@effect/ui"
import { Effect, Layer } from "effect"
import { Clock, ClockView } from "./Clock"
import { Activity, ConsoleView, DirectoryApi, Session } from "./Console"
import { Counter, CounterView } from "./Counter"
import { Todos, TodosView } from "./Todos"
import { DirectoryView } from "./Directory"
import { ResourcesView } from "./Resources"
import { VirtualizedView } from "./Virtualized"
import { HttpDemoLayer, HttpView } from "./Http"

const Handles: Array<Mount.Running> = []

let PageClosed = false

const DisposeDemo = async (): Promise<void> => {
  PageClosed = true
  const Failures: Array<unknown> = []

  while (Handles.length > 0) {
    const Handle = Handles.pop()!

    try {
      await Handle.dispose()
    } catch (Failure) {
      Failures.push(Failure)
    }
  }

  if (Failures.length > 0) throw new AggregateError(Failures, "Demo cleanup failed")
}

window.addEventListener(
  "pagehide",
  () => {
    void DisposeDemo().catch((Failure) => console.error("Demo cleanup failed", Failure))
  },
  { once: true }
)

const mountInto = async <E, R, ELayer>(
  selector: string,
  app: Application.Application<E, R>,
  layer: Layer.Layer<NoInfer<R>, ELayer>
): Promise<void> => {
  const el = document.querySelector<HTMLElement>(selector)

  if (el === null || PageClosed) return

  const Handle = await Application.start(app, el, layer)

  if (PageClosed) await Handle.dispose()
  else Handles.push(Handle)
}

const CounterApp = Application.make<Counter>()(
  Effect.gen(function* () {
    const View = yield* CounterView

    return <View />
  })
)

const ClockApp = Application.make<Clock>()(
  Effect.gen(function* () {
    const View = yield* ClockView

    return <View />
  })
)

const TodosApp = Application.make<Todos>()(
  Effect.gen(function* () {
    const View = yield* TodosView

    return <View />
  })
)

const DirectoryApp = Application.make<Navigation.Service>()(
  Effect.gen(function* () {
    const View = yield* DirectoryView

    return <View />
  })
)

const ResourcesApp = Application.make()(Effect.succeed(<ResourcesView />))

const VirtualizedApp = Application.make()(Effect.succeed(<VirtualizedView />))

const HttpApp = Application.make<ResourceCache.Cache | Http.HttpClient.HttpClient>()(
  Effect.gen(function* () {
    const View = yield* HttpView

    return <View />
  })
)

const ConsoleApp = Application.make<
  Session | DirectoryApi | Activity | ResourceCache.Cache | Navigation.Service
>()(
  Effect.gen(function* () {
    const View = yield* ConsoleView

    return <View />
  })
)

const StartDemo = async (): Promise<void> => {
  try {
    await mountInto("#counter", CounterApp, Counter.layer)
    await mountInto("#clock", ClockApp, Clock.layer)
    await mountInto("#todos", TodosApp, Todos.layer)
    await mountInto("#directory", DirectoryApp, Navigation.browserLayer)
    await mountInto(
      "#console",
      ConsoleApp,
      Layer.mergeAll(
        Session.layer,
        DirectoryApi.layer,
        Activity.layer,
        ResourceCache.layer,
        Navigation.browserLayer
      )
    )
    await mountInto("#resources", ResourcesApp, Layer.empty)
    await mountInto("#virtualized", VirtualizedApp, Layer.empty)
    await mountInto("#http", HttpApp, Layer.mergeAll(HttpDemoLayer, ResourceCache.layer))
  } catch (Failure) {
    console.error("Demo startup failed", Failure)
    await DisposeDemo()
  }
}

void StartDemo().catch((Failure) => console.error("Demo cleanup failed", Failure))
