import { Context, Effect } from "effect"
import type { Host, Disposer } from "../Control.js"

export type LifecycleCallback = () => unknown

export const NoPendingMounts: Promise<void> = Promise.resolve()

export interface LifecycleSlot {
  Cleanups: Array<LifecycleCallback>
  Mounts: Array<LifecycleCallback>
  PendingMounts: Promise<void>
}

/** The per-instance lifecycle capability. Provided automatically by every component scope; never provide it by hand. */
export class Service extends Context.Service<Service, LifecycleSlot>()("@effect/ui/Lifecycle") {}

/**
 * Registers an Effect to run after the enclosing component's DOM is
 * inserted, with the registering context bound. Deferred failures go to
 * runtime cause reporting — they are not descendant error-boundary UI.
 */
export const mounted = Effect.fnUntraced(function* <A, E, R>(action: Effect.Effect<A, E, R>) {
  const slot = yield* Service
  const context = yield* Effect.context<R>()
  slot.Mounts.push(() => Effect.runPromise(Effect.provideContext(action, context)))
})

/**
 * Registers scoped release. The expected error channel must be `never` —
 * recover or log expected failures before registering. Defects remain
 * defects. Use `Lifecycle.onCleanup` from components.
 */
export const cleanup = <A, R>(action: Effect.Effect<A, never, R>) =>
  Effect.addFinalizer(() => action)

/** Register a callback to run when the enclosing component's DOM is removed. */
export const onCleanup = (Callback: LifecycleCallback): Effect.Effect<void, never, Service> =>
  Effect.gen(function* () {
    const slot = yield* Service
    slot.Cleanups.push(Callback)
  })

/** Register a callback to run after the enclosing component's DOM is mounted. */
export const onMount = (Callback: LifecycleCallback): Effect.Effect<void, never, Service> =>
  Effect.gen(function* () {
    const slot = yield* Service
    slot.Mounts.push(Callback)
  })

export const CleanupCallbacks = (
  Callbacks: ReadonlyArray<LifecycleCallback>
): ReadonlyArray<Disposer> =>
  Callbacks.map((Callback) => async () => {
    const result = Callback()

    if (Effect.isEffect(result))
      throw new TypeError("Use Lifecycle.onCleanup(action) for Effect cleanup")
    await result
  })

const RunMountCallback = (
  Callback: LifecycleCallback,
  RendererHost: Pick<Host, "reportError">
): Promise<void> | undefined => {
  try {
    const Result = Callback()

    if (Effect.isEffect(Result))
      throw new TypeError("Use Lifecycle.onMount(action) for Effect mount actions")

    if (Result === undefined) return

    return Promise.resolve(Result).then(() => undefined, RendererHost.reportError)
  } catch (error) {
    RendererHost.reportError(error)
  }
}

export const RunMountCallbacks = (
  Callbacks: ReadonlyArray<LifecycleCallback>,
  RendererHost: Pick<Host, "reportError">
): Promise<void> => {
  const Pending: Array<Promise<void>> = []

  for (const Callback of Callbacks) {
    const Settled = RunMountCallback(Callback, RendererHost)

    if (Settled !== undefined) Pending.push(Settled)
  }

  return Pending.length === 0 ? NoPendingMounts : Promise.all(Pending).then(() => undefined)
}
