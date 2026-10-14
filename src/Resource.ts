import { Cause, Effect, Exit, Fiber, FiberHandle, Option, Scope, Semaphore, Stream } from "effect"
import { Signal, type Source } from "./Signal.js"

export type ResourceState<A, E> =
  | { readonly status: "pending"; readonly previous: Option.Option<A> }
  | { readonly status: "success"; readonly value: A }
  | {
      readonly status: "failure"
      readonly cause: Cause.Cause<E>
      readonly previous: Option.Option<A>
    }
  | { readonly status: "cancelled"; readonly previous: Option.Option<A> }

interface ResourceSnapshot<A, E> {
  readonly generation: number
  readonly state: ResourceState<A, E>
}

export interface Resource<A, E> {
  /** Current read-only load state. Pending and failure retain the last successful value. */
  readonly state: ResourceStateSignal<ResourceState<A, E>>
  /** The current state followed by each subsequent state transition. */
  readonly changes: Stream.Stream<ResourceState<A, E>>
  /** Interrupts the active load and starts it again. */
  readonly refresh: Effect.Effect<void>
  /** Interrupts the active load and leaves the resource cancelled. */
  readonly cancel: Effect.Effect<void>
}

export type ResourceStateSignal<A> = Source<A>

type CompleteLoad<R> = (Generation: number) => Effect.Effect<void, never, R>

type ResourceRunner<R> = (EffectValue: Effect.Effect<void, never, R>) => Fiber.Fiber<void, never>

const PreviousValue = <A, E>(State: ResourceState<A, E>): Option.Option<A> =>
  State.status === "success" ? Option.some(State.value) : State.previous

const SettleSnapshot = <A, E>(
  Current: ResourceSnapshot<A, E>,
  Generation: number,
  Result: Exit.Exit<A, E>
): ResourceSnapshot<A, E> => {
  if (Current.generation !== Generation) return Current

  const Previous = PreviousValue(Current.state)

  return Exit.match(Result, {
    onSuccess: (Value) => ({
      generation: Generation,
      state: { status: "success", value: Value }
    }),
    onFailure: (CauseValue) => ({
      generation: Generation,
      state: Cause.hasInterruptsOnly(CauseValue)
        ? { status: "cancelled", previous: Previous }
        : { status: "failure", cause: CauseValue, previous: Previous }
    })
  })
}

const makeStateView = <A, E>(
  Snapshot: Signal<ResourceSnapshot<A, E>>
): ResourceStateSignal<ResourceState<A, E>> =>
  Signal.fromSource({
    get: Effect.map(Snapshot.get, (Current) => Current.state),
    changes: Snapshot.changes.pipe(Stream.map((Current) => Current.state)),
    get value(): ResourceState<A, E> {
      return Snapshot.value.state
    }
  })

const makeCompleteLoad =
  <A, E, R>(
    Load: Effect.Effect<A, E, R>,
    Snapshot: Signal<ResourceSnapshot<A, E>>
  ): CompleteLoad<R> =>
  (Generation) =>
    Effect.exit(Load).pipe(
      Effect.flatMap((Result) =>
        Snapshot.update((Current) => SettleSnapshot(Current, Generation, Result))
      )
    )

const makeRefresh = <A, E, R>(
  Snapshot: Signal<ResourceSnapshot<A, E>>,
  FiberValue: FiberHandle.FiberHandle<void, never>,
  Lock: Semaphore.Semaphore,
  Run: ResourceRunner<R>,
  Complete: CompleteLoad<R>
): Effect.Effect<void> =>
  Lock.withPermit(
    Effect.gen(function* () {
      const Current = yield* Snapshot.get
      const Generation = Current.generation + 1
      const Previous = PreviousValue(Current.state)

      yield* Snapshot.set({
        generation: Generation,
        state: { status: "pending", previous: Previous }
      })
      yield* FiberHandle.clear(FiberValue)
      Run(Complete(Generation))
    })
  )

const makeCancel = <A, E>(
  Snapshot: Signal<ResourceSnapshot<A, E>>,
  FiberValue: FiberHandle.FiberHandle<void, never>,
  Lock: Semaphore.Semaphore
): Effect.Effect<void> =>
  Lock.withPermit(
    Effect.gen(function* () {
      const Current = yield* Snapshot.get
      const Generation = Current.generation + 1

      yield* Snapshot.set({
        generation: Generation,
        state: { status: "cancelled", previous: PreviousValue(Current.state) }
      })
      yield* FiberHandle.clear(FiberValue)
    })
  )

export const make = Effect.fnUntraced(function* <A, E, R>(
  Load: Effect.Effect<A, E, R>
): Effect.fn.Return<Resource<A, E>, never, R | Scope.Scope> {
  const Snapshot = yield* Signal.make<ResourceSnapshot<A, E>>({
    generation: 0,
    state: { status: "pending", previous: Option.none() }
  })

  const FiberValue = yield* FiberHandle.make<void, never>()
  const Run = yield* FiberHandle.runtime(FiberValue)<R>()
  const Lock = yield* Semaphore.make(1)
  const Complete = makeCompleteLoad(Load, Snapshot)
  const Refresh = makeRefresh(Snapshot, FiberValue, Lock, Run, Complete)
  const Cancel = makeCancel(Snapshot, FiberValue, Lock)

  const ResourceValue: Resource<A, E> = {
    state: makeStateView(Snapshot),
    changes: Signal.changes(Snapshot).pipe(Stream.map((Current) => Current.state)),
    refresh: Refresh,
    cancel: Cancel
  }

  yield* Refresh

  return ResourceValue
})

export const refresh = <A, E>(self: Resource<A, E>) => self.refresh

export const cancel = <A, E>(self: Resource<A, E>) => self.cancel

export const Resource = { make, refresh, cancel }
