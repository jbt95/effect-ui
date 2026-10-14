import type { Effect } from "effect"
import type { Scope } from "effect"
import type { Element, ElementChild, ElementProps } from "./Element.js"
import type { Local } from "./Component.js"
import type { LifecycleSlot } from "./runtime/Lifecycle.js"

/** Tears down a mounted subtree, including asynchronous Effect finalizers. */
export type Disposer = () => Promise<void>

export const noop: Disposer = async () => {}

export const combine = (disposers: ReadonlyArray<Disposer>): Disposer => {
  let disposal: Promise<void> | undefined

  return () => {
    if (disposal !== undefined) return disposal
    disposal = Promise.resolve().then(async () => {
      const errors: Array<unknown> = []

      for (const dispose of disposers) {
        try {
          await dispose()
        } catch (error) {
          errors.push(error)
        }
      }

      if (errors.length === 1) throw errors[0]

      if (errors.length > 1)
        throw new AggregateError(errors, "Multiple errors occurred while disposing a UI subtree")
    })

    return disposal
  }
}

/**
 * The DOM host handed to control-flow primitives (`<Show>`, `<For>`) so they can
 * build and tear down dynamic subtrees. Kept intentionally small so the host is
 * a single swappable seam (a future non-DOM renderer only re-implements these).
 */
export interface Host {
  readonly renderNode: (node: ElementChild, parent: Node, anchor?: Node | null) => Disposer
  readonly renderNodeWithHost: (
    node: ElementChild,
    parent: Node,
    rendererHost: Host,
    anchor?: Node | null
  ) => Disposer
  readonly fork: (effect: Effect.Effect<unknown, unknown, never>) => Disposer
  readonly runHandler: (
    effect: Effect.Effect<unknown, unknown, never>,
    onComplete?: () => void
  ) => Disposer

  /**
   * Error-cause convention: `cause` is an arbitrary Effect cause or DOM
   * failure forwarded to the mount boundary. The host never decodes it, so it
   * stays `unknown` at this boundary and is reported as-is.
   */
  readonly reportError: (cause: unknown) => void
  /** Retains asynchronous render rollback until the owning runtime is disposed. */
  readonly trackCleanup: (cleanup: Promise<void>) => void
  readonly createScope: () => Scope.Closeable
  readonly closeScope: (scope: Scope.Closeable) => Promise<void>
  readonly runComponent: (
    effect: Effect.Effect<Element, unknown, Local>,
    scope: Scope.Closeable,
    slot: LifecycleSlot
  ) => Element
  readonly queueMount: (callback: () => void) => void
  readonly flushMounts: () => void
}

/**
 * A control-flow primitive (e.g. `Show`, `For`). Like a component, usable as a
 * JSX tag, but its `control` function drives dynamic DOM over time.
 */
export interface Control<in out P extends object> {
  (props: P): Element
  readonly kind: string
  readonly control: (props: P, parent: Node, host: Host, anchor?: Node | null) => Disposer
}

export const Control = {
  /** Create a typed JSX control tag backed by a DOM controller. */
  make: <P extends object>(kind: string, control: Control<P>["control"]): Control<P> => {
    let tag: Control<P>

    const asElement = (props: P): Element => {
      return {
        type: tag,
        props: Object.fromEntries(Object.entries(props)),
        children: []
      }
    }

    tag = Object.assign(asElement, { kind, control })

    return tag
  }
}

/** Type guard distinguishing control tags from intrinsic tags / components. */
export const isControl = (u: unknown): u is Control<ElementProps> =>
  typeof u === "function" && "kind" in u && "control" in u

/** Remove all sibling nodes strictly between `start` and `end` (exclusive). */
export const removeBetween = (start: Node, end: Node): void => {
  let node: Node | null = start.nextSibling

  while (node !== null && node !== end) {
    const next: Node | null = node.nextSibling
    node.parentNode?.removeChild(node)
    node = next
  }
}

/** Insert `node` before `anchor`, or append to `parent` when no anchor is given. */
export const insert = (parent: Node, node: Node, anchor?: Node | null): void => {
  if (anchor === undefined || anchor === null) parent.appendChild(node)
  else parent.insertBefore(node, anchor)
}
