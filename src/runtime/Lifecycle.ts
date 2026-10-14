import { Effect } from "effect"
import type { Host, Disposer } from "../Control.js"

export type LifecycleCallback = () => unknown

export const NoPendingMounts: Promise<void> = Promise.resolve()

export interface LifecycleSlot {
  Cleanups: Array<LifecycleCallback>
  Mounts: Array<LifecycleCallback>
  PendingMounts: Promise<void>
}

let CurrentSlot: LifecycleSlot | null = null

/** Register a callback to run when the enclosing component's DOM is removed. */
export const onCleanup = (Callback: LifecycleCallback): Effect.Effect<void> =>
  Effect.sync(() => {
    if (CurrentSlot !== null) CurrentSlot.Cleanups.push(Callback)
  })

/** Register a callback to run after the enclosing component's DOM is mounted. */
export const onMount = (Callback: LifecycleCallback): Effect.Effect<void> =>
  Effect.sync(() => {
    if (CurrentSlot !== null) CurrentSlot.Mounts.push(Callback)
  })

export const CleanupCallbacks = (
  Callbacks: ReadonlyArray<LifecycleCallback>
): ReadonlyArray<Disposer> =>
  Callbacks.map((Callback) => async () => {
    await Callback()
  })

export const RunMountCallbacks = (
  Callbacks: ReadonlyArray<LifecycleCallback>,
  RendererHost: Host
): Promise<void> => {
  let Pending: Array<Promise<void>> | undefined

  for (const Callback of Callbacks) {
    try {
      const Result = Callback()

      if (Result !== undefined) {
        const Settled = Promise.resolve(Result).then(
          () => undefined,
          (CallbackError) => {
            RendererHost.reportError(CallbackError)
          }
        )

        if (Pending === undefined) Pending = [Settled]
        else Pending.push(Settled)
      }
    } catch (CallbackError) {
      RendererHost.reportError(CallbackError)
    }
  }

  return Pending === undefined ? NoPendingMounts : Promise.all(Pending).then(() => undefined)
}

export const withLifecycleSlot = <A>(Slot: LifecycleSlot, Run: () => A): A => {
  const PreviousSlot = CurrentSlot
  CurrentSlot = Slot

  try {
    return Run()
  } finally {
    CurrentSlot = PreviousSlot
  }
}
