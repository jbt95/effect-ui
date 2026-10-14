import { Effect, Pipeable, Scope, Stream, SubscriptionRef } from "effect"
import { dual } from "effect/Function"

export const TypeId: unique symbol = Symbol.for("@effect/ui/Signal")

/** Covariant, branded readable protocol shared by state, selectors and adapters. */
export interface Source<out A> extends Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly get: Effect.Effect<A>
  readonly value: A
  readonly changes: Stream.Stream<A>
  [Symbol.iterator](): ReturnType<Effect.Effect<A>[typeof Symbol.iterator]>
}

export interface Writable<in out A> extends Source<A> {
  readonly set: (value: A) => Effect.Effect<void>
  readonly update: (f: (value: A) => A) => Effect.Effect<void>
}

/** Input for adapting an external, environment-closed reactive source. */
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

export const fromSource = <A>(source: SourceOptions<A>): Source<A> => new Readable(source)

const readableRef = <A>(ref: SubscriptionRef.SubscriptionRef<A>): Source<A> =>
  fromSource({
    get: SubscriptionRef.get(ref),
    get value() {
      return SubscriptionRef.getUnsafe(ref)
    },
    changes: SubscriptionRef.changes(ref)
  })

/** A read-only facade, with no write operations at runtime. */
export const readonly = <A>(self: Source<A>): Source<A> => fromSource(self)

export const make = <A>(value: A): Effect.Effect<Writable<A>> =>
  SubscriptionRef.make(value).pipe(
    Effect.map((ref) =>
      Object.assign(readableRef(ref), {
        set: (next: A) => SubscriptionRef.set(ref, next),
        update: (f: (value: A) => A) => SubscriptionRef.update(ref, f)
      })
    )
  )

export const get = <A>(self: Source<A>): Effect.Effect<A> => self.get

export const changes = <A>(self: Source<A>): Stream.Stream<A> => self.changes

export const set: {
  <A>(value: A): (self: Writable<A>) => Effect.Effect<void>
  <A>(self: Writable<A>, value: A): Effect.Effect<void>
} = dual(2, <A>(self: Writable<A>, value: A) => self.set(value))

export const update: {
  <A>(f: (value: A) => A): (self: Writable<A>) => Effect.Effect<void>
  <A>(self: Writable<A>, f: (value: A) => A): Effect.Effect<void>
} = dual(2, <A>(self: Writable<A>, f: (value: A) => A) => self.update(f))

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
export const isSource = (value: unknown): value is Source<unknown> =>
  typeof value === "object" && value !== null && TypeId in value

/** @deprecated Import the module namespace; writable state is Signal.Writable<A>. */
export type Signal<A> = Writable<A>

/** @deprecated Use Signal.Source. */
export type SignalSource<A> = Source<A>

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
