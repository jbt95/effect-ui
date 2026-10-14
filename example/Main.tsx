import { Component, mount, type ElementProps } from "@effect/ui"
import { Layer } from "effect"
import type { Scope } from "effect"
import { Clock, ClockView } from "./Clock"
import { Counter, CounterView } from "./Counter"
import { Todos, TodosView } from "./Todos"
import { DirectoryView } from "./Directory"
import { ResourcesView } from "./Resources"
import { VirtualizedView } from "./Virtualized"
import { HttpDemoLayer, HttpView } from "./Http"

const mountInto = <E, R>(
  selector: string,
  view: Component<ElementProps, E, R>,
  layer: Layer.Layer<Exclude<R, Scope.Scope>, E, never>
): void => {
  const el = document.querySelector<HTMLElement>(selector)

  if (el !== null) mount(view, el, layer)
}

mountInto("#counter", CounterView, Counter.layer)

mountInto("#clock", ClockView, Clock.layer)

mountInto("#todos", TodosView, Todos.layer)

mountInto("#directory", DirectoryView, Layer.empty)

mountInto("#resources", ResourcesView, Layer.empty)

mountInto("#virtualized", VirtualizedView, Layer.empty)

mountInto("#http", HttpView, HttpDemoLayer)
