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

/**
 * Typed mount failure. Startup and teardown report through `MountError`
 * rather than throwing unstructured values; inspect `cause` for the
 * underlying render, assembly, or disposal failure.
 */
export class MountError extends Data.TaggedError("MountError")<{ readonly cause: unknown }> {}

/** Mount options. Root props are supplied in assembly JSX, not here. */
export interface Options {
  // oxlint-disable-next-line better-antislop/no-unknown-parameters -- Unexpected UI defects are reported at the runtime seam.
  /** Receives uncaught failures from lifecycle callbacks, handlers, and reactive updates. */
  readonly onError?: (cause: unknown) => void
}

/** A mounted application. Leaving the owning scope tears the mount down. */
export interface Mounted {
  /** The container the application range was mounted into. */
  readonly container: HTMLElement
  /** Idempotent early teardown. Prefer scope exit when a scope is available. */
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

/**
 * Mounts an application into the surrounding `Scope`. DOM, assembly
 * resources, and component subtrees are owned by that scope: leaving it
 * awaits in-flight fibers, instance finalizers, and service releases.
 * Failed initial mounting awaits rollback before failing. Provide
 * application services through normal Effect composition.
 *
 * ```ts
 * const program = Effect.scoped(Effect.gen(function* () {
 *   const mounted = yield* Mount.scoped(App, container)
 *   yield* waitForHostShutdown
 *   yield* mounted.close
 * }))
 * ```
 */
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

/**
 * A `Layer` whose lifetime owns the mounted application. Closing the layer
 * tears the mount down; useful for long-lived hosts composed from layers.
 */
export const layer = <E, R>(app: Application<E, R>, container: HTMLElement, options?: Options) =>
  Layer.effectDiscard(scoped(app, container, options))

/** A running application started through the Promise adapter. */
export interface Running extends Mounted {
  /** Promise teardown. Await it so finalizers complete before the host proceeds. */
  readonly dispose: () => Promise<void>
}

/**
 * Starts an application from plain (non-Effect) host code. Unlike the legacy
 * imperative mount, asynchronous service layers and assembly are supported:
 * `services` is built with `Layer.buildWithScope` in an owned scope. Do not
 * place acquired tags outside the returned handle's lifetime.
 *
 * ```ts
 * const running = await Application.start(App, container, UsersLayer)
 * await running.dispose()
 * ```
 */
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
