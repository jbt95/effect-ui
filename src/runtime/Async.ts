import { Cause, Effect, Option, Stream } from "effect"
import {
  combine,
  Control,
  insert,
  noop,
  removeBetween,
  type Disposer,
  type Host
} from "../Control.js"
import type { ElementChild } from "../Element.js"
import type { Resource, ResourceState } from "../Resource.js"
import { ownerDocument } from "./Dom.js"

export interface AsyncSharedProps<E = unknown> {
  readonly fallback?: ElementChild
  readonly error?: (cause: unknown) => ElementChild
  readonly failure?: (cause: Cause.Cause<E>) => ElementChild
}

export type AsyncProps<E = unknown> = AsyncSharedProps<E> &
  (
    | { readonly effect: Effect.Effect<ElementChild, E>; readonly resource?: never }
    | { readonly resource: Resource<ElementChild, E>; readonly effect?: never }
  )

interface AsyncState<E> {
  readonly Props: AsyncProps<E>
  readonly Parent: Node
  readonly Host: Host
  readonly Start: Comment
  readonly End: Comment
  Current: Disposer
  CurrentChild: ElementChild
  HasCurrentChild: boolean
  Transition: Promise<void>
  Cancel: Disposer
  Disposed: boolean
}

const transition = async <E>(state: AsyncState<E>, child: ElementChild): Promise<void> => {
  if (state.Disposed) return
  const previous = state.Current
  state.Current = noop
  state.HasCurrentChild = false
  removeBetween(state.Start, state.End)

  try {
    await previous()
  } catch (error) {
    state.Host.reportError(error)
  }

  if (state.Disposed) return
  state.Current = state.Host.renderNode(child, state.Parent, state.End)
  state.CurrentChild = child
  state.HasCurrentChild = true
}

const branch = <E>(state: AsyncState<E>, child: ElementChild): Promise<void> => {
  if (state.Disposed || (state.HasCurrentChild && Object.is(state.CurrentChild, child)))
    return Promise.resolve()
  const pending = transition(state, child)
  // Effect interruption cannot abandon the underlying native cleanup promise.
  state.Transition = pending.catch(() => {})

  return pending
}

const failureView = <E>(state: AsyncState<E>, cause: Cause.Cause<E>): ElementChild => {
  if (state.Props.failure !== undefined) return state.Props.failure(cause)

  if (state.Props.error !== undefined) return state.Props.error(Cause.squash(cause))
  state.Host.reportError(Cause.squash(cause))

  return undefined
}

const fail = <E>(state: AsyncState<E>, cause: Cause.Cause<E>): Promise<void> => {
  if (state.Disposed || Cause.hasInterruptsOnly(cause)) return Promise.resolve()

  return branch(state, failureView(state, cause))
}

const previous = <E>(
  state: AsyncState<E>,
  value: Option.Option<ElementChild>,
  fallback?: ElementChild
) => branch(state, Option.isSome(value) ? value.value : fallback)

const resourceState = <E>(
  state: AsyncState<E>,
  value: ResourceState<ElementChild, E>
): Promise<void> => {
  if (value.status === "pending") return previous(state, value.previous, state.Props.fallback)

  if (value.status === "success") return branch(state, value.value)

  if (value.status === "cancelled") return previous(state, value.previous)

  if (state.Props.failure !== undefined || state.Props.error !== undefined)
    return fail(state, value.cause)
  state.Host.reportError(Cause.squash(value.cause))

  return previous(state, value.previous)
}

const start = <E>(state: AsyncState<E>): Disposer => {
  if (state.Props.resource !== undefined) return observe(state, state.Props.resource)

  const task = state.Props.effect.pipe(
    Effect.flatMap((value) => Effect.promise(() => branch(state, value))),
    Effect.catchCause((cause) => Effect.promise(() => fail(state, cause))),
    Effect.catchCause((cause) => Effect.sync(() => state.Host.reportError(Cause.squash(cause))))
  )

  return state.Host.fork(task)
}

const observe = <E>(state: AsyncState<E>, resource: Resource<ElementChild, E>): Disposer =>
  state.Host.fork(
    resource.changes.pipe(
      Stream.runForEach((value) => Effect.promise(() => resourceState(state, value))),
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          if (!Cause.hasInterruptsOnly(cause)) state.Host.reportError(Cause.squash(cause))
        })
      )
    )
  )

const dispose = async <E>(state: AsyncState<E>): Promise<void> => {
  state.Disposed = true
  const current = state.Current
  state.Current = noop
  removeBetween(state.Start, state.End)
  state.Start.remove()
  state.End.remove()
  await combine([state.Cancel, () => state.Transition, current])()
}

const createState = <E>(
  Props: AsyncProps<E>,
  Parent: Node,
  Host: Host,
  Anchor?: Node | null
): AsyncState<E> => {
  const document = ownerDocument(Parent)
  const Start = document.createComment("async")
  const End = document.createComment("/async")
  insert(Parent, Start, Anchor)
  insert(Parent, End, Anchor)

  return {
    Props,
    Parent,
    Host,
    Start,
    End,
    Current: noop,
    CurrentChild: Props.fallback,
    HasCurrentChild: true,
    Transition: Promise.resolve(),
    Cancel: noop,
    Disposed: false
  }
}

export const mountAsync = <E>(
  props: AsyncProps<E>,
  parent: Node,
  host: Host,
  anchor?: Node | null
): Disposer => {
  const state = createState(props, parent, host, anchor)

  try {
    state.Current = host.renderNode(props.fallback, parent, state.End)
  } catch (error) {
    removeBetween(state.Start, state.End)
    state.Start.remove()
    state.End.remove()
    throw error
  }

  state.Cancel = start(state)

  return () => dispose(state)
}

/** @deprecated The canonical public adapter is Async.View with data-valued sources. */
export const Async = Control.make<AsyncProps>("control/async", mountAsync)
