import { Effect, Scope, Stream, SubscriptionRef } from "effect"

/**
 * A reactive value container, backed by a `SubscriptionRef`.
 *
 * A `Signal` can be:
 *  - read: `.value` (unsafe snapshot) and `.get` (an `Effect`)
 *  - mutated: `.set(v)` and `.update(f)` (return `Effect<void>`)
 *  - placed as a JSX child, where the DOM host subscribes to its changes and
 *    patches only the bound text node as it changes (fine-grained reactivity).
 *
 * There is a single type `Signal<A>` usable both as a value namespace
 * (`Signal.make(...)`, `Signal.map(...)`) and as a type (`Signal<number>`).
 */
export interface SignalSource<out A> {
  readonly get: Effect.Effect<A>
  readonly value: A
  readonly changes: Stream.Stream<A>
}

export interface Signal<in out A> extends SignalSource<A> {
  readonly update: (f: (a: A) => A) => Effect.Effect<void>
  readonly set: (a: A) => Effect.Effect<void>
  readonly [RefKey]: SubscriptionRef.SubscriptionRef<A>
}

const RefKey: unique symbol = Symbol.for("@effect/ui/Signal/ref")

const fromRef = <A>(ref: SubscriptionRef.SubscriptionRef<A>): Signal<A> => ({
  get: SubscriptionRef.get(ref),
  get value(): A {
    return SubscriptionRef.getUnsafe(ref)
  },
  changes: SubscriptionRef.changes(ref),
  update: (f) => SubscriptionRef.update(ref, f),
  set: (a) => SubscriptionRef.set(ref, a),
  [RefKey]: ref
})

export const Signal = {
  /** Create a signal with an initial value. */
  make: <A>(a: A): Effect.Effect<Signal<A>> => SubscriptionRef.make(a).pipe(Effect.map(fromRef)),

  /** A stream that emits the current value, then every subsequent change. */
  changes: <A>(self: SignalSource<A>): Stream.Stream<A> => self.changes,

  /**
   * Derive a new signal. A background fiber (owned by the enclosing `Scope`,
   * e.g. a service layer or component subtree) keeps it in sync with `f(self)`.
   */
  map: <A, B>(self: Signal<A>, f: (a: A) => B): Effect.Effect<Signal<B>, never, Scope.Scope> =>
    Effect.gen(function* () {
      const derived = yield* SubscriptionRef.make(f(self.value))
      yield* SubscriptionRef.changes(self[RefKey]).pipe(
        Stream.map(f),
        Stream.runForEach((b) => SubscriptionRef.set(derived, b)),
        Effect.forkScoped
      )

      return fromRef(derived)
    }),

  /**
   * Memoize a selector over explicit signal dependencies. The selector runs
   * once initially and then on dependency changes; equal results are not
   * emitted. The update fibers are interrupted with the enclosing scope.
   */
  memo: <A>(
    dependencies: ReadonlyArray<SignalSource<unknown>>,
    select: () => A,
    equals: (previous: A, next: A) => boolean = Object.is
  ): Effect.Effect<Signal<A>, never, Scope.Scope> =>
    Effect.gen(function* () {
      if (dependencies.length === 0) {
        throw new TypeError("[@effect/ui] Signal.memo requires at least one dependency")
      }

      const UniqueDependencies = Array.from(new Set(dependencies))
      const InitialValues = UniqueDependencies.map((dependency) => dependency.value)
      const derived = yield* SubscriptionRef.make(select())

      for (const [Index, dependency] of UniqueDependencies.entries()) {
        let PreviousDependencyValue = InitialValues[Index]

        yield* dependency.changes.pipe(
          Stream.runForEach((DependencyValue) => {
            if (Object.is(PreviousDependencyValue, DependencyValue)) return Effect.void

            PreviousDependencyValue = DependencyValue

            return Effect.gen(function* () {
              const NextValue = select()
              const PreviousValue = yield* SubscriptionRef.get(derived)

              if (!equals(PreviousValue, NextValue)) yield* SubscriptionRef.set(derived, NextValue)
            })
          }),
          Effect.forkScoped
        )
      }

      return fromRef(derived)
    }),

  isSignal: (u: unknown): u is Signal<unknown> => typeof u === "object" && u !== null && RefKey in u
}
