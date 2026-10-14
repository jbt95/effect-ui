import { Cause, Effect } from "effect"
import { Control, insert, noop, removeBetween, type Disposer, type Host } from "../Control.js"
import type { ElementChild } from "../Element.js"
import { ownerDocument } from "./Dom.js"

export interface ErrorBoundaryProps {
  /** Descendant subtree whose render and runtime failures this boundary handles. */
  readonly children?: ElementChild
  /** Fallback content or a builder that receives the failure and a reset action. */
  readonly fallback: ElementChild | ((cause: unknown, reset: () => void) => ElementChild)
}

interface ErrorBoundaryState {
  readonly Props: ErrorBoundaryProps
  readonly Parent: Node
  readonly Host: Host
  readonly Start: Comment
  readonly End: Comment
  BoundaryHost: Host
  Current: Disposer
  Transition: Promise<void>
  Error: unknown
  HasError: boolean
  Disposed: boolean
}

const buildFallback = (State: ErrorBoundaryState): ElementChild => {
  const Reset = (): void => resetBoundary(State)
  const Fallback = State.Props.fallback

  return typeof Fallback === "function" ? Fallback(State.Error, Reset) : Fallback
}

const renderBranch = (
  State: ErrorBoundaryState,
  Render: () => Disposer,
  onFailure: (error: unknown) => void
): Promise<void> => {
  const Transition = async (): Promise<void> => {
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

    try {
      State.Current = Render()
    } catch (error) {
      onFailure(error)
    }
  }

  State.Transition = State.Transition.then(Transition)

  return State.Transition
}

const reportBoundaryError = (State: ErrorBoundaryState, error: unknown): void => {
  if (State.Disposed || State.HasError) return

  State.Error = error
  State.HasError = true
  void renderBranch(
    State,
    () => State.Host.renderNode(buildFallback(State), State.Parent, State.End),
    State.Host.reportError
  )
}

const resetBoundary = (State: ErrorBoundaryState): void => {
  if (State.Disposed || !State.HasError) return

  State.Error = undefined
  State.HasError = false
  void renderBranch(
    State,
    () => State.BoundaryHost.renderNode(State.Props.children, State.Parent, State.End),
    (error) => reportBoundaryError(State, error)
  )
}

const captureEffect = (
  State: ErrorBoundaryState,
  effect: Effect.Effect<unknown, unknown, never>
): Effect.Effect<unknown, never, never> =>
  effect.pipe(
    Effect.catchCause((cause) => Effect.sync(() => reportBoundaryError(State, Cause.squash(cause))))
  )

const createBoundaryHost = (State: ErrorBoundaryState): Host => {
  let BoundaryHost: Host

  BoundaryHost = {
    renderNode: (node, parent, anchor) =>
      State.Host.renderNodeWithHost(node, parent, BoundaryHost, anchor),
    renderNodeWithHost: (node, parent, rendererHost, anchor) =>
      State.Host.renderNodeWithHost(node, parent, rendererHost, anchor),
    fork: (effect) => State.Host.fork(captureEffect(State, effect)),
    runHandler: (effect, onComplete) =>
      State.Host.runHandler(captureEffect(State, effect), onComplete),
    reportError: (error) => reportBoundaryError(State, error),
    trackCleanup: State.Host.trackCleanup,
    createScope: State.Host.createScope,
    closeScope: State.Host.closeScope,
    runComponent: State.Host.runComponent,
    queueMount: State.Host.queueMount,
    flushMounts: State.Host.flushMounts
  }

  return BoundaryHost
}

const createBoundaryMarkers = (
  Parent: Node,
  Host: Host,
  Anchor?: Node | null
): Pick<ErrorBoundaryState, "Parent" | "Host" | "Start" | "End"> => {
  const Document = ownerDocument(Parent)
  const Start = Document.createComment("error-boundary")
  const End = Document.createComment("/error-boundary")
  insert(Parent, Start, Anchor)

  try {
    insert(Parent, End, Anchor)
  } catch (error) {
    Start.remove()
    throw error
  }

  return { Parent, Host, Start, End }
}

const disposeBoundary = async (State: ErrorBoundaryState): Promise<void> => {
  State.Disposed = true
  removeBetween(State.Start, State.End)
  State.Start.remove()
  State.End.remove()
  await State.Transition

  const DisposeCurrent = State.Current
  State.Current = noop
  await DisposeCurrent()
}

const createErrorBoundaryState = (
  Props: ErrorBoundaryProps,
  Parent: Node,
  Host: Host,
  Anchor?: Node | null
): ErrorBoundaryState => {
  const Markers = createBoundaryMarkers(Parent, Host, Anchor)

  const State: ErrorBoundaryState = {
    ...Markers,
    Props,
    BoundaryHost: Host,
    Current: noop,
    Transition: Promise.resolve(),
    Error: undefined,
    HasError: false,
    Disposed: false
  }

  State.BoundaryHost = createBoundaryHost(State)

  return State
}

const renderInitialBoundary = (State: ErrorBoundaryState): void => {
  try {
    State.Current = State.BoundaryHost.renderNode(State.Props.children, State.Parent, State.End)
  } catch (error) {
    State.Error = error
    State.HasError = true
    removeBetween(State.Start, State.End)

    try {
      State.Current = State.Host.renderNode(buildFallback(State), State.Parent, State.End)
    } catch (fallbackError) {
      removeBetween(State.Start, State.End)
      State.Start.remove()
      State.End.remove()
      throw fallbackError
    }
  }
}

const mountErrorBoundary = (
  Props: ErrorBoundaryProps,
  Parent: Node,
  Host: Host,
  Anchor?: Node | null
): Disposer => {
  const State = createErrorBoundaryState(Props, Parent, Host, Anchor)

  renderInitialBoundary(State)

  return () => disposeBoundary(State)
}

export const ErrorBoundary = Control.make<ErrorBoundaryProps>(
  "control/error-boundary",
  mountErrorBoundary
)
