import { Data, Effect, Exit, Layer, Scope } from "effect"
import type { Application } from "./Application.js"
import { sync } from "./Component.js"
import { Fragment, jsx } from "./Element.js"
import { combine } from "./Control.js"
import { mount as mountDom } from "./runtime/Mount.js"
import {
  CleanupCallbacks,
  NoPendingMounts,
  RunMountCallbacks,
  Service,
  type LifecycleSlot
} from "./runtime/Lifecycle.js"

export class MountError extends Data.TaggedError("MountError")<{ readonly cause: unknown }> {}

export interface Options {
  // oxlint-disable-next-line better-antislop/no-unknown-parameters -- Unexpected UI defects are reported at the runtime seam.
  readonly onError?: (cause: unknown) => void
}

export interface Mounted {
  readonly container: HTMLElement
  readonly close: Effect.Effect<void, MountError>
}

const report = (options: Options): Options["onError"] =>
  options.onError ?? ((cause) => console.error("[@effect/ui] Unhandled runtime error", cause))

const makeOwner = (options: Options) => {
  let disposeDom: () => Promise<void> = async () => {}

  let pendingMounts = NoPendingMounts
  let failedMountCleanup = NoPendingMounts
  let disposal: Promise<void> | undefined
  const slot: LifecycleSlot = { Mounts: [], Cleanups: [], PendingMounts: NoPendingMounts }

  return {
    slot,
    attach: (dispose: () => Promise<void>) => {
      disposeDom = dispose
    },
    rollback: (cleanup: Promise<void>) => {
      failedMountCleanup = cleanup
    },
    commit: () => {
      pendingMounts = RunMountCallbacks(slot.Mounts, { reportError: report(options)! })
    },
    close: (scope: Scope.Closeable): Promise<void> => {
      disposal ??= combine([
        () => disposeDom(),
        () => failedMountCleanup,
        () => pendingMounts,
        () => Effect.runPromise(Scope.close(scope, Exit.void)),
        () => combine(CleanupCallbacks(slot.Cleanups))()
      ])()

      return disposal
    }
  }
}

/** Scoped acquisition. Effects and service Layers can initialize asynchronously; instance renders stay synchronous. */
export const scoped = Effect.fnUntraced(function* <E, R>(
  app: Application<E, R>,
  container: HTMLElement,
  options: Options = {}
): Effect.fn.Return<Mounted, E | MountError, R | Scope.Scope> {
  const context = yield* Effect.context<R>()
  const owner = makeOwner(options)

  const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Effect.promise(() => owner.close(scope))
  )

  const close = Effect.tryPromise({
    try: () => owner.close(scope),
    catch: (cause) => new MountError({ cause })
  })

  yield* Effect.gen(function* () {
    const child = yield* Scope.provide(scope)(
      Effect.provideService(app.assemble, Service, owner.slot)
    )

    const handle = yield* Effect.try({
      try: () =>
        mountDom(
          sync(() => jsx(Fragment, { children: child })),
          container,
          Layer.succeedContext(context),
          { ...options, onFailedMountCleanup: owner.rollback }
        ),
      catch: (cause) => new MountError({ cause })
    })

    owner.attach(handle.dispose)
    owner.commit()
  }).pipe(Effect.onError(() => close.pipe(Effect.orDie)))

  return { container, close }
})

/** Layer lifetime owns the application and all mounted descendants. */
export const layer = <E, R>(app: Application<E, R>, container: HTMLElement, options?: Options) =>
  Layer.effectDiscard(scoped(app, container, options))

export interface Running extends Mounted {
  readonly dispose: () => Promise<void>
}

/** Imperative Promise adapter. Unlike the old mount, asynchronous service Layers are supported. */
export const start = <R, EApp, ELayer>(
  app: Application<EApp, R>,
  container: HTMLElement,
  services: Layer.Layer<NoInfer<R>, ELayer>,
  options?: Options
): Promise<Running> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make()

      const started = Effect.gen(function* () {
        const context = yield* Layer.buildWithScope(services, scope)

        return yield* Scope.provide(scope)(
          Effect.provideContext(scoped(app, container, options), context)
        )
      }).pipe(Effect.onError(() => Scope.close(scope, Exit.void)))

      const mounted = yield* started
      const dispose = combine([() => Effect.runPromise(Scope.close(scope, Exit.void))])

      return {
        ...mounted,
        close: Effect.tryPromise({ try: dispose, catch: (cause) => new MountError({ cause }) }),
        dispose
      }
    })
  )
