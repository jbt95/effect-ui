import { Effect, Stream } from "effect"
import type { Scope } from "effect"
import { isComponent, type Component } from "../Component.js"
import { combine, insert, isControl, noop, type Disposer, type Host } from "../Control.js"
import { Fragment, isElement, type Element, type ElementProps } from "../Element.js"
import { Signal } from "../Signal.js"
import {
  createDomElement,
  ownerDocument,
  renderText,
  HANDLED_PROPS,
  applyAttrValue,
  type DomElement
} from "./Dom.js"
import { applyProps, bindRef } from "./Bindings.js"
import { disposeAfterFailure } from "./Disposal.js"
import { createReactiveUpdateBinding } from "./Scheduler.js"
import {
  CleanupCallbacks,
  type LifecycleCallback,
  type LifecycleSlot,
  NoPendingMounts,
  RunMountCallbacks
} from "./Lifecycle.js"

const bindText = (
  signal: import("../Signal.js").Source<unknown>,
  parent: Node,
  host: Host,
  anchor?: Node | null
): Disposer => {
  const text = ownerDocument(parent).createTextNode(renderText(signal.value))
  insert(parent, text, anchor)

  const binding = createReactiveUpdateBinding((value) => voidNode(text, value), host.reportError)

  const watcher = host.fork(
    Signal.changes(signal).pipe(
      Stream.runForEach((value) => Effect.sync(() => binding.schedule(value)))
    )
  )

  return combine([
    async () => {
      binding.dispose()
    },
    watcher
  ])
}

const voidNode = (node: Text, value: unknown): void => {
  node.nodeValue = renderText(value)
}

const renderChildren = (
  children: ReadonlyArray<unknown>,
  parent: Node,
  host: Host,
  anchor?: Node | null
): Disposer => {
  const disposers: Array<Disposer> = []

  try {
    for (const child of children) disposers.push(renderNode(child, parent, host, anchor))
  } catch (error) {
    return disposeAfterFailure(error, disposers, host)
  }

  return combine(disposers)
}

const abandonComponent = (
  scope: Scope.Closeable,
  cleanups: ReadonlyArray<LifecycleCallback>,
  host: Host
): void => {
  host.trackCleanup(
    combine([() => host.closeScope(scope), ...CleanupCallbacks(cleanups)])().catch(host.reportError)
  )
}

const renderComponentChild = (
  ComponentValue: Component<ElementProps, unknown>,
  Props: ElementProps,
  Parent: Node,
  Host: Host,
  Anchor: Node | null | undefined,
  ScopeValue: Scope.Closeable,
  Slot: LifecycleSlot
): Disposer => {
  try {
    const Child = Host.runComponent(ComponentValue.render(Props), ScopeValue, Slot)

    return renderNode(Child, Parent, Host, Anchor)
  } catch (error) {
    abandonComponent(ScopeValue, Slot.Cleanups, Host)
    throw error
  }
}

const mountComponent = (
  comp: Component<ElementProps, unknown>,
  props: ElementProps,
  parent: Node,
  host: Host,
  anchor?: Node | null
): Disposer => {
  // Each component renders within its own scope so local `Signal.map`,
  // `Effect.forkScoped`, and finalizers are owned by — and cleaned up with —
  // this component's DOM subtree.
  const Scope = host.createScope()
  const Slot: LifecycleSlot = { Cleanups: [], Mounts: [], PendingMounts: NoPendingMounts }
  const ChildDisposer = renderComponentChild(comp, props, parent, host, anchor, Scope, Slot)

  host.queueMount(() => {
    Slot.PendingMounts = RunMountCallbacks(Slot.Mounts, host)
  })

  return combine([
    ChildDisposer,
    () => Slot.PendingMounts,
    () => host.closeScope(Scope),
    ...CleanupCallbacks(Slot.Cleanups)
  ])
}

const prepareSelectOptions = (dom: DomElement, props: ElementProps): void => {
  if (dom.localName !== "select") return

  // Both rendering paths must establish selection mode before any options are inserted.
  for (const name of ["multiple", "size"]) {
    const property = props[name]
    const value = Signal.isSignal(property) ? property.value : property

    if (value !== undefined && value !== null) applyAttrValue(dom, name, value)
  }
}

const renderDomContents = (
  dom: DomElement,
  props: ElementProps,
  children: ReadonlyArray<unknown>,
  host: Host
): Disposer => {
  prepareSelectOptions(dom, props)
  const childDisposer = renderChildren(children, dom, host)

  try {
    return combine([applyProps(dom, props, host), childDisposer])
  } catch (error) {
    return disposeAfterFailure(error, [childDisposer], host)
  }
}

const insertDomElement = (
  dom: DomElement,
  parent: Node,
  anchor: Node | null | undefined,
  disposer: Disposer,
  host: Host
): void => {
  try {
    insert(parent, dom, anchor)
  } catch (error) {
    disposeAfterFailure(error, [disposer], host)
  }
}

const bindDomElementRef = (
  dom: DomElement,
  ref: ElementProps["ref"],
  subtreeDisposer: Disposer,
  host: Host
): Disposer => {
  try {
    return combine([subtreeDisposer, bindRef(ref, dom)])
  } catch (error) {
    dom.remove()

    return disposeAfterFailure(error, [subtreeDisposer], host)
  }
}

const isStaticPropValue = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"

const isStaticProps = (props: ElementProps): boolean => {
  // A ref callback or object needs cleanup on disposal; event props need
  // listener removal. Anything else dynamic falls back to the full path.
  if (props.ref !== undefined) return false

  for (const name of Object.keys(props)) {
    // `children` renders from the element's child list and `key` never
    // reaches the DOM, mirroring the attribute wiring below.
    if (name === "children" || name === "key") continue

    if (name.toLowerCase().startsWith("on")) return false

    if (!isStaticPropValue(props[name])) return false
  }

  return true
}

const isStaticChild = (node: unknown): boolean => {
  if (node === null || node === undefined || typeof node === "boolean") return true

  if (typeof node === "string" || typeof node === "number") return true

  if (Array.isArray(node)) return node.every(isStaticChild)

  if (!isElement(node) || (typeof node.type !== "string" && node.type !== Fragment)) return false

  if (!isStaticProps(node.props)) return false

  return node.children.every(isStaticChild)
}

const renderStaticChild = (child: unknown, parent: Node, anchor?: Node | null): void => {
  if (child === null || child === undefined || typeof child === "boolean") return

  if (typeof child === "string" || typeof child === "number") {
    insert(parent, ownerDocument(parent).createTextNode(renderText(child)), anchor)

    return
  }

  if (Array.isArray(child)) {
    for (const entry of child) renderStaticChild(entry, parent, anchor)

    return
  }

  // SAFETY: renderStaticChild runs only on subtrees accepted by isStaticChild,
  // so an Element here has a string or Fragment type.
  const element = child as Element

  renderStaticElementChild(element, parent, anchor)
}

const renderStaticElementChild = (element: Element, parent: Node, anchor?: Node | null): void => {
  if (element.type === Fragment) {
    for (const entry of element.children) renderStaticChild(entry, parent, anchor)

    return
  }

  // SAFETY: isStaticChild established the type is a string when it is not Fragment.
  renderStaticElement(element.type as string, element.props, element.children, parent, anchor)
}

const applyStaticProps = (dom: DomElement, props: ElementProps): void => {
  // Mirrors applyProps for the static subset: class/id/style first, then
  // unclaimed attributes, sharing applyAttrValue so attribute semantics
  // (including URL validation throws) stay identical.
  const classValue = props.class !== undefined ? props.class : props.className

  if (classValue !== undefined && classValue !== null) applyAttrValue(dom, "class", classValue)

  if (props.id !== undefined && props.id !== null) applyAttrValue(dom, "id", props.id)

  if (props.style !== undefined && props.style !== null) applyAttrValue(dom, "style", props.style)

  for (const [name, value] of Object.entries(props)) {
    if (HANDLED_PROPS.has(name) || name.toLowerCase().startsWith("on")) continue

    if (value === undefined || value === null) continue
    applyAttrValue(dom, name, value)
  }
}

const renderStaticElement = (
  type: string,
  props: ElementProps,
  children: ReadonlyArray<unknown>,
  parent: Node,
  anchor?: Node | null
): void => {
  const dom = createDomElement(type, parent)
  prepareSelectOptions(dom, props)

  for (const child of children) renderStaticChild(child, dom, undefined)

  // Like the dynamic path, child-dependent properties (for example select.value) run last.
  applyStaticProps(dom, props)
  insert(parent, dom, anchor)
}

const renderDomElement = (
  type: string,
  props: ElementProps,
  children: ReadonlyArray<unknown>,
  parent: Node,
  host: Host,
  anchor?: Node | null
): Disposer => {
  const dom = createDomElement(type, parent)
  const subtreeDisposer = renderDomContents(dom, props, children, host)

  insertDomElement(dom, parent, anchor, subtreeDisposer, host)

  return bindDomElementRef(dom, props.ref, subtreeDisposer, host)
}

const renderFragmentNode = (
  children: ReadonlyArray<unknown>,
  parent: Node,
  host: Host,
  anchor?: Node | null
): Disposer => {
  if (children.every(isStaticChild)) {
    for (const child of children) renderStaticChild(child, parent, anchor)

    return noop
  }

  return renderChildren(children, parent, host, anchor)
}

const renderIntrinsicNode = (
  type: string,
  props: ElementProps,
  children: ReadonlyArray<unknown>,
  parent: Node,
  host: Host,
  anchor?: Node | null
): Disposer => {
  if (isStaticProps(props) && children.every(isStaticChild)) {
    renderStaticElement(type, props, children, parent, anchor)

    return noop
  }

  return renderDomElement(type, props, children, parent, host, anchor)
}

const renderElement = (node: Element, parent: Node, host: Host, anchor?: Node | null): Disposer => {
  const { type, props, children } = node

  if (isControl(type)) return type.control(props, parent, host, anchor)

  if (isComponent(type)) return mountComponent(type, props, parent, host, anchor)

  if (type === Fragment) return renderFragmentNode(children, parent, host, anchor)

  if (typeof type === "string")
    return renderIntrinsicNode(type, props, children, parent, host, anchor)

  return noop
}

export const renderNode = (
  node: unknown,
  parent: Node,
  host: Host,
  anchor?: Node | null
): Disposer => {
  if (node === null || node === undefined || typeof node === "boolean") return noop

  if (typeof node === "string" || typeof node === "number") {
    insert(parent, ownerDocument(parent).createTextNode(renderText(node)), anchor)

    return noop
  }

  if (Signal.isSignal(node)) return bindText(node, parent, host, anchor)

  if (Array.isArray(node)) return renderChildren(node, parent, host, anchor)

  if (isElement(node)) return renderElement(node, parent, host, anchor)
  insert(parent, ownerDocument(parent).createTextNode(renderText(node)), anchor)

  return noop
}

// ---------------------------------------------------------------------------
// Control flow: <Show> and <For>
// ---------------------------------------------------------------------------
