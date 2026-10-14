import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime, Scope } from "effect"
import type { Component } from "../Component.js"
import { combine, insert, noop, removeBetween, type Disposer, type Host } from "../Control.js"
import type { Element, ElementChild, ElementProps } from "../Element.js"
import { renderNode } from "./Renderer.js"
import {
  CleanupCallbacks,
  type LifecycleSlot,
  NoPendingMounts,
  RunMountCallbacks,
  withLifecycleSlot
} from "./Lifecycle.js"

export interface Handle<R = never, E = never> {
  readonly runtime: ManagedRuntime.ManagedRuntime<R, E>
  /** Interrupts bindings and awaits all subtree and runtime finalizers. */
  readonly dispose: () => Promise<void>
}

export type MountOptions<P extends object = ElementProps> = {
  /** Receives failures from lifecycle callbacks, handlers, and reactive DOM updates. */
  readonly onError?: (error: unknown) => void
} & ({} extends P ? { readonly props?: P } : { readonly props: P })

class RootMountHost<P extends object, R, E> implements Host {
  private readonly MountQueue: Array<() => void> = []
  private DeferMounts = true
  private FlushingMounts = false
  private RenderDepth = 0
  private Closed = false

  constructor(
    private readonly Runtime: ManagedRuntime.ManagedRuntime<R, E>,
    private readonly Settings: MountOptions<P>
  ) {}

  private interruptFiber(
    fiber: ReturnType<ManagedRuntime.ManagedRuntime<R, E>["runFork"]>
  ): Disposer {
    let interruption: Promise<void> | undefined

    return () => {
      interruption ??= this.Runtime.runPromise(Fiber.interrupt(fiber))

      return interruption
    }
  }

  private completeHandler(onComplete?: () => void): () => void {
    return () => {
      try {
        onComplete?.()
      } catch (error) {
        this.reportError(error)
      }
    }
  }

  private watchHandlerCompletion(
    fiber: ReturnType<ManagedRuntime.ManagedRuntime<R, E>["runFork"]>,
    complete: () => void
  ): void {
    void this.Runtime.runPromise(Fiber.await(fiber)).then(complete, (error) => {
      this.reportError(error)
      complete()
    })
  }

  readonly close = (): void => {
    this.Closed = true
    this.MountQueue.length = 0
  }

  readonly reportError: Host["reportError"] = (error) => {
    try {
      if (this.Settings.onError !== undefined) this.Settings.onError(error)
      else console.error("[@effect/ui] Unhandled runtime error", error)
    } catch (reportingError) {
      console.error("[@effect/ui] Error while reporting a runtime error", reportingError, error)
    }
  }

  readonly renderNode: Host["renderNode"] = (node, parent, anchor) =>
    this.renderNodeWithHost(node, parent, this, anchor)

  private renderUsingHost(
    node: ElementChild,
    parent: Node,
    rendererHost: Host,
    anchor?: Node | null
  ): Disposer {
    const mountCheckpoint = this.MountQueue.length
    this.RenderDepth += 1

    try {
      return renderNode(node, parent, rendererHost, anchor)
    } catch (error) {
      this.MountQueue.splice(mountCheckpoint)
      throw error
    } finally {
      this.RenderDepth -= 1
    }
  }

  private flushRenderedMounts(disposer: Disposer): Disposer {
    if (this.DeferMounts || this.RenderDepth !== 0) return disposer

    try {
      this.flushMounts()
    } catch (error) {
      void disposer().catch(this.reportError)
      throw error
    }

    return disposer
  }

  readonly renderNodeWithHost: Host["renderNodeWithHost"] = (
    node,
    parent,
    rendererHost,
    anchor
  ) => {
    if (this.Closed) return noop

    return this.flushRenderedMounts(this.renderUsingHost(node, parent, rendererHost, anchor))
  }

  readonly fork: Host["fork"] = (effect) => {
    if (this.Closed) return noop
    const fiber = this.Runtime.runFork(effect)

    return this.interruptFiber(fiber)
  }

  readonly runHandler: Host["runHandler"] = (handler, onComplete) => {
    const complete = this.completeHandler(onComplete)

    if (this.Closed) {
      complete()

      return noop
    }

    const fiber = this.Runtime.runFork(
      handler.pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            if (!Cause.hasInterruptsOnly(cause)) this.reportError(Cause.squash(cause))
          })
        )
      )
    )

    if (onComplete !== undefined) this.watchHandlerCompletion(fiber, complete)

    return this.interruptFiber(fiber)
  }

  readonly createScope: Host["createScope"] = () =>
    this.Runtime.runSync(Scope.fork(this.Runtime.scope))

  readonly closeScope: Host["closeScope"] = (scope) =>
    this.Runtime.runPromise(Scope.close(scope, Exit.void))

  readonly runComponent: Host["runComponent"] = (effect, scope) => {
    // SAFETY: JSX erases nested component service requirements; the root runtime provides R.
    const provided = Scope.provide(scope)(effect) as Effect.Effect<Element, unknown, R>

    return this.Runtime.runSync(provided)
  }

  readonly queueMount: Host["queueMount"] = (callback) => this.MountQueue.push(callback)

  readonly flushMounts: Host["flushMounts"] = () => {
    if (this.Closed) {
      this.MountQueue.length = 0

      return
    }

    if (this.FlushingMounts) return
    this.FlushingMounts = true

    try {
      while (this.MountQueue.length > 0) {
        const callbacks = this.MountQueue.splice(0)

        for (const callback of callbacks) callback()
      }
    } finally {
      this.FlushingMounts = false
    }
  }

  enableMounts(): void {
    this.DeferMounts = false
  }
}

interface RootRange {
  readonly Start: Comment
  readonly End: Comment
}

interface RootMountAdapter extends Host {
  readonly close: () => void
  enableMounts(): void
}

const removeRootRange = (Range: RootRange, IncludeChildren: boolean): void => {
  if (IncludeChildren) removeBetween(Range.Start, Range.End)
  Range.Start.remove()
  Range.End.remove()
}

const disposeAfterMountFailure = <R, E>(
  Runtime: ManagedRuntime.ManagedRuntime<R, E>,
  Host: RootMountAdapter,
  Cleanup: Promise<void>
): void => {
  void Cleanup.catch(Host.reportError)
    .then(() => Runtime.dispose())
    .catch(Host.reportError)
}

const awaitRootAndRuntimeCleanup = async <R, E>(
  Cleanup: Promise<void>,
  Runtime: ManagedRuntime.ManagedRuntime<R, E>
): Promise<void> => {
  const Errors: Array<unknown> = []

  try {
    await Cleanup
  } catch (error) {
    Errors.push(error)
  }

  try {
    await Runtime.dispose()
  } catch (error) {
    Errors.push(error)
  }

  if (Errors.length === 1) throw Errors[0]

  if (Errors.length > 1)
    throw new AggregateError(Errors, "Multiple errors occurred while disposing the UI runtime")
}

const createRootDisposer = <R, E>(
  Runtime: ManagedRuntime.ManagedRuntime<R, E>,
  Host: RootMountAdapter,
  Range: RootRange,
  DisposeRoot: Disposer
): Disposer => {
  let Disposal: Promise<void> | undefined

  return () => {
    if (Disposal !== undefined) return Disposal

    Host.close()
    const Cleanup = DisposeRoot()
    removeRootRange(Range, true)
    Disposal = awaitRootAndRuntimeCleanup(Cleanup, Runtime)

    return Disposal
  }
}

const createRootScope = <R, E>(
  Runtime: ManagedRuntime.ManagedRuntime<R, E>,
  Host: RootMountAdapter
): Scope.Closeable => {
  try {
    return Host.createScope()
  } catch (error) {
    Host.close()
    void Runtime.dispose().catch(Host.reportError)
    throw error
  }
}

const renderRootElement = <P extends object, E, R>(
  ComponentValue: Component<P, E, R>,
  Props: P,
  Runtime: ManagedRuntime.ManagedRuntime<Exclude<R, Scope.Scope>, E>,
  Host: RootMountAdapter,
  RootScope: Scope.Closeable,
  RootSlot: LifecycleSlot,
  Range: RootRange
): Element => {
  try {
    return withLifecycleSlot(RootSlot, () =>
      Runtime.runSync(Scope.provide(RootScope)(ComponentValue.render(Props)))
    )
  } catch (error) {
    Host.close()
    removeRootRange(Range, false)

    const Cleanup = combine([
      () => Host.closeScope(RootScope),
      ...CleanupCallbacks(RootSlot.Cleanups)
    ])()

    disposeAfterMountFailure(Runtime, Host, Cleanup)
    throw error
  }
}

const renderRootChildren = <R, E>(
  Root: Element,
  Container: HTMLElement,
  Runtime: ManagedRuntime.ManagedRuntime<R, E>,
  Host: RootMountAdapter,
  RootScope: Scope.Closeable,
  RootSlot: LifecycleSlot,
  Range: RootRange
): Disposer => {
  try {
    return renderNode(Root, Container, Host, Range.End)
  } catch (error) {
    Host.close()
    removeRootRange(Range, true)

    const Cleanup = combine([
      () => Host.closeScope(RootScope),
      ...CleanupCallbacks(RootSlot.Cleanups)
    ])()

    disposeAfterMountFailure(Runtime, Host, Cleanup)
    throw error
  }
}

const insertRootRange = (Container: HTMLElement): RootRange => {
  const Range: RootRange = {
    Start: Container.ownerDocument.createComment("effect-ui root"),
    End: Container.ownerDocument.createComment("/effect-ui root")
  }

  insert(Container, Range.Start)
  insert(Container, Range.End)

  return Range
}

const finishRootMount = <R, E>(
  RootChildrenDisposer: Disposer,
  RootScope: Scope.Closeable,
  RootSlot: LifecycleSlot,
  Range: RootRange,
  Runtime: ManagedRuntime.ManagedRuntime<R, E>,
  Host: RootMountAdapter
): Disposer => {
  const DisposeRoot = combine([
    RootChildrenDisposer,
    () => RootSlot.PendingMounts,
    () => Host.closeScope(RootScope),
    ...CleanupCallbacks(RootSlot.Cleanups)
  ])

  Host.queueMount(() => {
    RootSlot.PendingMounts = RunMountCallbacks(RootSlot.Mounts, Host)
  })
  Host.enableMounts()

  try {
    Host.flushMounts()
  } catch (error) {
    Host.close()
    const Cleanup = DisposeRoot()
    removeRootRange(Range, true)
    disposeAfterMountFailure(Runtime, Host, Cleanup)
    throw error
  }

  return createRootDisposer(Runtime, Host, Range, DisposeRoot)
}

const mountRoot = <P extends object, E, R>(
  ComponentValue: Component<P, E, R>,
  Container: HTMLElement,
  Props: P,
  Runtime: ManagedRuntime.ManagedRuntime<Exclude<R, Scope.Scope>, E>,
  Host: RootMountAdapter
): Disposer => {
  const RootScope = createRootScope(Runtime, Host)
  const Range = insertRootRange(Container)

  const RootSlot: LifecycleSlot = { Cleanups: [], Mounts: [], PendingMounts: NoPendingMounts }
  const Root = renderRootElement(ComponentValue, Props, Runtime, Host, RootScope, RootSlot, Range)

  const RootChildrenDisposer = renderRootChildren(
    Root,
    Container,
    Runtime,
    Host,
    RootScope,
    RootSlot,
    Range
  )

  return finishRootMount(RootChildrenDisposer, RootScope, RootSlot, Range, Runtime, Host)
}

/**
 * Mount `component` into `container`, building every service from `layer` once.
 * Returns a handle whose `dispose` releases all subscriptions + the runtime.
 */
export function mount<P extends object = ElementProps, E = never, R = never>(
  component: Component<P, E, R>,
  container: HTMLElement,
  layer: Layer.Layer<Exclude<R, Scope.Scope>, E, never>,
  ...options: {} extends P ? [options?: MountOptions<P>] : [options: MountOptions<P>]
): Handle<Exclude<R, Scope.Scope>, E>
export function mount<P extends object, E, R>(
  component: Component<P, E, R>,
  container: HTMLElement,
  layer: Layer.Layer<Exclude<R, Scope.Scope>, E, never>,
  options?: MountOptions<P>
): Handle<Exclude<R, Scope.Scope>, E> {
  // SAFETY: The overload requires options.props for non-empty P; omission is valid only for {}.
  const settings: MountOptions<P> = options ?? ({} as MountOptions<P>)
  const runtime = ManagedRuntime.make(layer)
  const host = new RootMountHost(runtime, settings)
  // SAFETY: Missing props are permitted by the mount overload only when P is empty.
  const rootProps = settings.props ?? ({} as P)
  const dispose = mountRoot(component, container, rootProps, runtime, host)

  return { runtime, dispose }
}
