import { Cause, Effect, Option, Stream } from "effect"
import { Control, insert, noop, removeBetween, type Disposer, type Host } from "../Control.js"
import type { ElementChild } from "../Element.js"
import type { Resource, ResourceState } from "../Resource.js"
import { ownerDocument } from "./Dom.js"

interface AsyncSharedProps {
  /** Content shown until the effect succeeds or fails. */
  readonly fallback?: ElementChild
  /** Optional local failure view. Without it, the failure is reported to `onError`. */
  readonly error?: (cause: unknown) => ElementChild
}

export type AsyncProps = AsyncSharedProps &
  (
    | {
        /** Closed Effect that asynchronously creates the subtree. */
        readonly effect: Effect.Effect<ElementChild, unknown, never>
        readonly resource?: never
      }
    | { readonly resource: Resource<ElementChild, unknown>; readonly effect?: never }
  )

interface AsyncState {
  readonly Props: AsyncProps
  readonly Parent: Node
  readonly Host: Host
  readonly Start: Comment
  readonly End: Comment
  Current: Disposer
  Cancel: Disposer
  Disposed: boolean
}

const renderAsyncBranch = async (State: AsyncState, Child: ElementChild): Promise<void> => {
  if (State.Disposed) return

  const DisposePrevious = State.Current
  State.Current = noop
  removeBetween(State.Start, State.End)

  try {
    await DisposePrevious()
  } catch (error) {
    State.Host.reportError(error)
  }

  if (State.Disposed) return

  State.Current = State.Host.renderNode(Child, State.Parent, State.End)
}

const failAsyncBranch = async (
  State: AsyncState,
  CauseValue: Cause.Cause<unknown>
): Promise<void> => {
  const ErrorValue = Cause.squash(CauseValue)

  if (State.Props.error === undefined) {
    State.Host.reportError(ErrorValue)
    await renderAsyncBranch(State, undefined)

    return
  }

  await renderAsyncBranch(State, State.Props.error(ErrorValue))
}

const disposeAsyncState = async (State: AsyncState): Promise<void> => {
  State.Disposed = true

  try {
    await State.Cancel()
  } finally {
    const DisposeCurrent = State.Current
    State.Current = noop
    removeBetween(State.Start, State.End)
    State.Start.remove()
    State.End.remove()
    await DisposeCurrent()
  }
}

const createAsyncMarkers = (
  Parent: Node,
  Host: Host,
  Anchor?: Node | null
): Pick<AsyncState, "Parent" | "Host" | "Start" | "End"> => {
  const Document = ownerDocument(Parent)
  const Start = Document.createComment("async")
  const End = Document.createComment("/async")
  insert(Parent, Start, Anchor)
  insert(Parent, End, Anchor)

  return { Parent, Host, Start, End }
}

const runAsyncEffect = (
  State: AsyncState,
  EffectValue: Effect.Effect<ElementChild, unknown, never>
): Disposer => {
  const Task = Effect.flatMap(EffectValue, (Value) =>
    Effect.promise(() => renderAsyncBranch(State, Value))
  ).pipe(
    Effect.catchCause((CauseValue) => Effect.promise(() => failAsyncBranch(State, CauseValue))),
    Effect.catchCause((CauseValue) =>
      Effect.sync(() => State.Host.reportError(Cause.squash(CauseValue)))
    )
  )

  return State.Host.fork(Task)
}

const renderPrevious = (
  State: AsyncState,
  Previous: Option.Option<ElementChild>
): Promise<void> => {
  if (Option.isSome(Previous)) return renderAsyncBranch(State, Previous.value)

  return renderAsyncBranch(State, undefined)
}

const renderPendingResource = (
  State: AsyncState,
  Previous: Option.Option<ElementChild>
): Promise<void> => {
  if (Option.isSome(Previous)) return renderAsyncBranch(State, Previous.value)

  return renderAsyncBranch(State, State.Props.fallback)
}

const renderFailedResource = (
  State: AsyncState,
  ResourceStateValue: Extract<ResourceState<ElementChild, unknown>, { readonly status: "failure" }>
): Promise<void> => {
  const ErrorValue = Cause.squash(ResourceStateValue.cause)

  if (State.Props.error !== undefined) {
    return renderAsyncBranch(State, State.Props.error(ErrorValue))
  }

  State.Host.reportError(ErrorValue)

  return renderPrevious(State, ResourceStateValue.previous)
}

const renderResourceState = (
  State: AsyncState,
  ResourceStateValue: ResourceState<ElementChild, unknown>
): Promise<void> => {
  if (ResourceStateValue.status === "pending") {
    return renderPendingResource(State, ResourceStateValue.previous)
  }

  if (ResourceStateValue.status === "success") {
    return renderAsyncBranch(State, ResourceStateValue.value)
  }

  if (ResourceStateValue.status === "failure") {
    return renderFailedResource(State, ResourceStateValue)
  }

  return renderPrevious(State, ResourceStateValue.previous)
}

const runAsyncResource = (
  State: AsyncState,
  ResourceValue: Resource<ElementChild, unknown>
): Disposer => {
  const Observe = ResourceValue.changes.pipe(
    Stream.runForEach((ResourceStateValue) =>
      Effect.promise(() => renderResourceState(State, ResourceStateValue))
    ),
    Effect.catchCause((CauseValue) =>
      Effect.sync(() => {
        if (!Cause.hasInterruptsOnly(CauseValue)) {
          State.Host.reportError(Cause.squash(CauseValue))
        }
      })
    )
  )

  return State.Host.fork(Observe)
}

const runAsync = (State: AsyncState): Disposer => {
  if (State.Props.resource === undefined) {
    return runAsyncEffect(State, State.Props.effect)
  }

  return runAsyncResource(State, State.Props.resource)
}

const mountAsync = (
  Props: AsyncProps,
  Parent: Node,
  Host: Host,
  Anchor?: Node | null
): Disposer => {
  const Markers = createAsyncMarkers(Parent, Host, Anchor)

  const State: AsyncState = {
    ...Markers,
    Props,
    Current: noop,
    Cancel: noop,
    Disposed: false
  }

  try {
    State.Current = Host.renderNode(Props.fallback, Parent, State.End)
  } catch (error) {
    State.Start.remove()
    State.End.remove()
    throw error
  }

  State.Cancel = runAsync(State)

  return () => disposeAsyncState(State)
}

export const Async = Control.make<AsyncProps>("control/async", mountAsync)
