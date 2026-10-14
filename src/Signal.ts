import { Effect, Pipeable, Scope, Stream, SubscriptionRef } from "effect"
import { dual } from "effect/Function"

export const TypeId: unique symbol = Symbol.for("@effect/ui/Signal")

/**
 * A branded, covariant readable reactive value.
 *
 * A `Source` exposes the current value synchronously (`.value`), as an
 * `Effect` (`.get`, or simply `yield* source`), and as a `Stream` of the
 * current value followed by every change (`.changes`). Sources are
 * `Pipeable`, so module functions double as pipeable operators.
 *
 * Writable state, derived selectors, and adapted external values all share
 * this protocol; JSX and derived combinators accept any `Source`, never a
 * bare `{ value }` object.
 *
 * ```ts
 * const count = yield* Signal.make(0)
 * const doubled = yield* Signal.map(count, (n) => n * 2)
 * const snapshot: number = yield* doubled
 * ```
 */
export interface Source<out A> extends Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly get: Effect.Effect<A>
  readonly value: A
  readonly changes: Stream.Stream<A>
  [Symbol.iterator](): ReturnType<Effect.Effect<A>[typeof Symbol.iterator]>
}

/**
 * Writable reactive state. Only `Signal.make` produces a `Writable`;
 * derived selectors (`Signal.map`, `Signal.memo`) and
 * `Signal.readonly` facades expose the read-only `Source` protocol, so
 * writing to derived state is a type error rather than a silent no-op.
 */
export interface Writable<in out A> extends Source<A> {
  readonly set: (value: A) => Effect.Effect<void>
  readonly update: (f: (value: A) => A) => Effect.Effect<void>
}

/**
 * The closed inputs for adapting an external reactive value. `get` reads the
 * value, `changes` emits the current value followed by updates, and `value`
 * must be a live getter — never a stale snapshot.
 */
export interface SourceOptions<out A> {
  readonly get: Effect.Effect<A>
  readonly changes: Stream.Stream<A>
  readonly value: A
}

class Readable<A> extends Pipeable.Class implements Source<A> {
  readonly [TypeId]: typeof TypeId = TypeId
  constructor(private readonly source: SourceOptions<A>) {
    super()
  }
  get get(): Effect.Effect<A> {
    return this.source.get
  }
  get value(): A {
    return this.source.value
  }
  get changes(): Stream.Stream<A> {
    return this.source.changes
  }
  [Symbol.iterator](): ReturnType<Effect.Effect<A>[typeof Symbol.iterator]> {
    return this.get[Symbol.iterator]()
  }
}

/**
 * Adapts an external reactive value to the `Source` protocol. The adapted
 * Effect must already be closed (`R = never`): bind services with
 * `Action.bind` before adapting.
 *
 * ```ts
 * const source = Signal.fromSource({
 *   get: SubscriptionRef.get(ref),
 *   changes: SubscriptionRef.changes(ref),
 *   get value() { return SubscriptionRef.getUnsafe(ref) }
 * })
 * ```
 */
export const fromSource = <A>(source: SourceOptions<A>): Source<A> => new Readable(source)

const readableRef = <A>(ref: SubscriptionRef.SubscriptionRef<A>): Source<A> =>
  fromSource({
    get: SubscriptionRef.get(ref),
    get value() {
      return SubscriptionRef.getUnsafe(ref)
    },
    changes: SubscriptionRef.changes(ref)
  })

/**
 * A read-only facade over any `Source`, with no write operations at runtime.
 * Use it before exposing internal state to readers that must not mutate it.
 */
export const readonly = <A>(self: Source<A>): Source<A> => fromSource(self)

/**
 * Creates writable reactive state with an initial value.
 *
 * ```ts
 * const count = yield* Signal.make(0)
 * yield* count.update((n) => n + 1)
 * ```
 */
export const make = <A>(value: A): Effect.Effect<Writable<A>> =>
  SubscriptionRef.make(value).pipe(
    Effect.map((ref) =>
      Object.assign(readableRef(ref), {
        set: (next: A) => SubscriptionRef.set(ref, next),
        update: (f: (value: A) => A) => SubscriptionRef.update(ref, f)
      })
    )
  )

/** Reads the current value of any `Source` as an `Effect`. */
export const get = <A>(self: Source<A>): Effect.Effect<A> => self.get

/** The stream of a `Source`'s current value followed by every subsequent change. */
export const changes = <A>(self: Source<A>): Stream.Stream<A> => self.changes

/**
 * Replaces the value of writable state. Also usable as a pipeable operator:
 * `count.pipe(Signal.set(1))`.
 */
export const set: {
  <A>(value: A): (self: Writable<A>) => Effect.Effect<void>
  <A>(self: Writable<A>, value: A): Effect.Effect<void>
} = dual(2, <A>(self: Writable<A>, value: A) => self.set(value))

/**
 * Updates writable state with a pure function. Also usable as a pipeable
 * operator: `count.pipe(Signal.update((n) => n + 1))`.
 */
export const update: {
  <A>(f: (value: A) => A): (self: Writable<A>) => Effect.Effect<void>
  <A>(self: Writable<A>, f: (value: A) => A): Effect.Effect<void>
} = dual(2, <A>(self: Writable<A>, f: (value: A) => A) => self.update(f))

/**
 * Derives a read-only `Source` that stays in sync with its input. The
 * background fiber is owned by the enclosing `Scope` — a component subtree,
 * a service layer, or an explicit `Effect.scoped` region — and is
 * interrupted with it. Accepts any `Source`, writable or derived.
 *
 * ```ts
 * const doubled = yield* Signal.map(count, (n) => n * 2)
 * ```
 */
export const map: {
  <A, B>(f: (value: A) => B): (self: Source<A>) => Effect.Effect<Source<B>, never, Scope.Scope>
  <A, B>(self: Source<A>, f: (value: A) => B): Effect.Effect<Source<B>, never, Scope.Scope>
} = dual(
  2,
  Effect.fnUntraced(function* <A, B>(self: Source<A>, f: (value: A) => B) {
    const derived = yield* SubscriptionRef.make(f(self.value))
    yield* self.changes.pipe(
      Stream.map(f),
      Stream.runForEach((value) => SubscriptionRef.set(derived, value)),
      Effect.forkScoped
    )

    return readableRef(derived)
  })
)

const watchMemo = Effect.fnUntraced(function* <A, B>(
  dependency: Source<B>,
  initial: B,
  derived: SubscriptionRef.SubscriptionRef<A>,
  select: () => A,
  equals: (previous: A, next: A) => boolean
) {
  let previous = initial
  yield* dependency.changes.pipe(
    Stream.runForEach((value) => {
      if (Object.is(previous, value)) return Effect.void
      previous = value

      return Effect.gen(function* () {
        const next = select()
        const current = yield* SubscriptionRef.get(derived)

        if (!equals(current, next)) yield* SubscriptionRef.set(derived, next)
      })
    }),
    Effect.forkScoped
  )
})

/**
 * Memoizes a selector over explicit dependencies. The selector runs once
 * initially and again whenever a dependency emits; results comparing equal
 * under `equals` (default `Object.is`) are not re-emitted. Dependencies are
 * read explicitly via `.value` inside `select` — nothing is tracked
 * automatically. Requires at least one dependency; update fibers are
 * interrupted with the enclosing scope.
 *
 * ```ts
 * const label = yield* Signal.memo([count], () => `Count: ${count.value}`)
 * ```
 */
export const memo = Effect.fnUntraced(function* <A>(
  dependencies: ReadonlyArray<Source<unknown>>,
  select: () => A,
  equals: (previous: A, next: A) => boolean = Object.is
): Effect.fn.Return<Source<A>, never, Scope.Scope> {
  if (dependencies.length === 0)
    throw new TypeError("[@effect/ui] Signal.memo requires at least one dependency")
  const unique = Array.from(new Set(dependencies))
  const initial = unique.map((dependency) => dependency.value)
  const derived = yield* SubscriptionRef.make(select())

  for (const [index, dependency] of unique.entries()) {
    yield* watchMemo(dependency, initial[index], derived, select, equals)
  }

  return readableRef(derived)
})

// oxlint-disable-next-line better-antislop/no-unknown-parameters -- A brand guard is the dynamic JSX decoding seam.
/**
 * Type guard recognizing any `Source` by its brand. Used everywhere the
 * runtime decodes dynamic values: JSX children and props, `Show`, and `For`.
 * An arbitrary object with a `.value` property is not a `Source`.
 */
export const isSource = (value: unknown): value is Source<unknown> =>
  typeof value === "object" && value !== null && TypeId in value

/** @deprecated Import the module namespace; writable state is Signal.Writable<A>. */
export type Signal<A> = Writable<A>

/** @deprecated Use Signal.Source. */
export type SignalSource<A> = Source<A>

/** Reactive values: writable state, read-only selectors, and adapters. See `Source`. */
export const Signal = {
  make,
  get,
  changes,
  set,
  update,
  map,
  memo,
  readonly,
  fromSource,
  isSource,
  isSignal: isSource
}
