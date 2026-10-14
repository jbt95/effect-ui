import { Effect, Stream } from "effect"
import { combine, noop, type Disposer, type Host } from "../Control.js"
import type { ElementProps, EventHandler } from "../Element.js"
import { Signal } from "../Signal.js"
import { disposeAfterFailure } from "./Disposal.js"
import { applyAttrValue, EVENT_PROP_NAMES, HANDLED_PROPS, type DomElement } from "./Dom.js"
import { createReactiveUpdateBinding } from "./Scheduler.js"

const isEventHandler = (value: unknown): value is EventHandler =>
  Effect.isEffect(value) || typeof value === "function"

const wireAttr = (
  dom: DomElement,
  name: string,
  value: unknown,
  host: Host,
  disposers: Array<Disposer>
): void => {
  if (value === undefined || value === null) return

  if (Signal.isSignal(value)) {
    wireSignalAttr(dom, name, value, host, disposers)
  } else {
    applyAttrValue(dom, name, value)
  }
}

const wireSignalAttr = (
  dom: DomElement,
  name: string,
  value: Signal<unknown>,
  host: Host,
  disposers: Array<Disposer>
): void => {
  applyAttrValue(dom, name, value.value)

  const binding = createReactiveUpdateBinding(
    (nextValue) => applyAttrValue(dom, name, nextValue),
    host.reportError
  )

  const resetDisposer = wireControlledFormReset(dom, name, value, host)

  const watcher = host.fork(
    Signal.changes(value).pipe(
      Stream.runForEach((nextValue) => Effect.sync(() => binding.schedule(nextValue)))
    )
  )

  disposers.push(async () => {
    binding.dispose()
    await resetDisposer()
    await watcher()
  })
}

const controlledFormOwner = (dom: DomElement, name: string): HTMLFormElement | null => {
  if (name === "selected" && dom.localName === "option") {
    return dom.closest("select")?.form ?? null
  }

  const IsValueControl = name === "value" && ["input", "select", "textarea"].includes(dom.localName)
  const IsCheckedControl = name === "checked" && dom.localName === "input"

  if (!IsValueControl && !IsCheckedControl) return null

  // SAFETY: The local-name checks above restrict `form` access to native form controls.
  return (dom as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).form
}

const wireControlledFormReset = (
  dom: DomElement,
  name: string,
  signal: Signal<unknown>,
  host: Host
): Disposer => {
  let form: HTMLFormElement | null = null
  let disposed = false

  const onReset = (event: Event): void => {
    queueMicrotask(() => {
      if (event.defaultPrevented || disposed) return

      try {
        applyAttrValue(dom, name, signal.value)
      } catch (error) {
        host.reportError(error)
      }
    })
  }

  host.queueMount(() => {
    if (disposed) return

    form = controlledFormOwner(dom, name)
    form?.addEventListener("reset", onReset)
  })

  return async () => {
    disposed = true
    form?.removeEventListener("reset", onReset)
  }
}

const wireEvent = (
  dom: DomElement,
  event: string,
  handler: EventHandler | undefined,
  host: Host,
  disposers: Array<Disposer>
): void => {
  if (handler === undefined) return
  const activeHandlers = new Set<{ dispose: Disposer }>()

  const listener = (event: Event): void => {
    const active = { dispose: noop }
    activeHandlers.add(active)

    try {
      const action = runEventHandler(handler, event)

      if (action === undefined) {
        activeHandlers.delete(active)

        return
      }

      if (!Effect.isEffect(action))
        throw new TypeError("[@effect/ui] event callbacks must return an Effect or void")

      active.dispose = host.runHandler(action, () => activeHandlers.delete(active))
    } catch (error) {
      activeHandlers.delete(active)
      host.reportError(error)
    }
  }

  dom.addEventListener(event, listener)
  disposers.push(async () => {
    dom.removeEventListener(event, listener)
    const running = Array.from(activeHandlers, (active) => active.dispose)
    activeHandlers.clear()
    await combine(running)()
  })
}

const runEventHandler = (
  Handler: EventHandler,
  EventValue: Event
): void | Effect.Effect<unknown, unknown, never> => {
  if (typeof Handler !== "function") return Handler

  // SAFETY: the native listener invokes this callback with its own Event,
  // whose currentTarget is the element that owns this listener.
  return Handler(EventValue as Event & { readonly currentTarget: EventTarget })
}

const wireEventProps = (
  dom: DomElement,
  props: ElementProps,
  host: Host,
  disposers: Array<Disposer>
): void => {
  for (const [propName, eventName] of Object.entries(EVENT_PROP_NAMES)) {
    const handler = props[propName]

    if (handler === undefined || handler === null) continue

    if (!isEventHandler(handler)) {
      throw new TypeError(`[@effect/ui] ${propName} must be an Effect or event callback`)
    }

    wireEvent(dom, eventName, handler, host, disposers)
  }
}

const wireUnclaimedProps = (
  dom: DomElement,
  props: ElementProps,
  host: Host,
  disposers: Array<Disposer>
): void => {
  for (const [name, value] of Object.entries(props)) {
    if (
      HANDLED_PROPS.has(name) ||
      name.toLowerCase().startsWith("on") ||
      value === undefined ||
      value === null
    )
      continue

    wireAttr(dom, name, value, host, disposers)
  }
}

export const applyProps = (dom: DomElement, props: ElementProps, host: Host): Disposer => {
  const disposers: Array<Disposer> = []

  try {
    wireAttr(
      dom,
      "class",
      props.class !== undefined ? props.class : props.className,
      host,
      disposers
    )
    wireAttr(dom, "id", props.id, host, disposers)
    wireAttr(dom, "style", props.style, host, disposers)
    wireEventProps(dom, props, host, disposers)
    // Unknown `on*` attributes are executable in the browser, so never pass them through.
    wireUnclaimedProps(dom, props, host, disposers)
  } catch (error) {
    return disposeAfterFailure(error, disposers, host)
  }

  return combine(disposers)
}

export const bindRef = (ref: ElementProps["ref"], dom: DomElement): Disposer => {
  if (ref === undefined) return noop

  if (typeof ref === "function") ref(dom)
  else ref.current = dom

  return async () => {
    if (typeof ref === "function") ref(null)
    else if (ref.current === dom) ref.current = null
  }
}
