import { describe, expect, it } from "vitest"
import { Deferred, Effect, Stream } from "effect"
import { Signal } from "../src/Signal"

describe("Signal", () => {
  it("derives a signal and reacts to updates", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const count = yield* Signal.make(0)
          const doubled = yield* Signal.map(count, (n) => n * 2)

          expect(count.value).toBe(0)
          expect(doubled.value).toBe(0)

          // Deterministically wait until the derived signal reaches 10.
          const reached10 = yield* Deferred.make<void>()
          yield* Signal.changes(doubled).pipe(
            Stream.filter((v) => v === 10),
            Stream.runForEach(() => Deferred.succeed(reached10, undefined)),
            Effect.forkScoped
          )

          yield* count.update((n) => n + 5)
          yield* Deferred.await(reached10)

          expect(count.value).toBe(5)
          expect(doubled.value).toBe(10)
        })
      )
    )
  })

  it("memoizes selectors across explicit heterogeneous dependencies", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Name = yield* Signal.make("Ada")
          const Visits = yield* Signal.make(0)
          let SelectorRuns = 0

          const Label = yield* Signal.memo([Name, Visits], () => {
            SelectorRuns += 1

            return `${Name.value}: ${Visits.value}`
          })

          const Updated = yield* Deferred.make<void>()

          expect(Label.value).toBe("Ada: 0")
          expect(SelectorRuns).toBe(1)

          yield* Signal.changes(Label).pipe(
            Stream.filter((Value) => Value === "Ada: 1"),
            Stream.runForEach(() => Deferred.succeed(Updated, undefined)),
            Effect.forkScoped
          )

          yield* Visits.set(1)
          yield* Deferred.await(Updated)

          expect(Label.value).toBe("Ada: 1")
          expect(SelectorRuns).toBe(2)
        })
      )
    )
  })

  it("uses equality to suppress unchanged selector results", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Count = yield* Signal.make(0)
          const Buckets: Array<number> = []
          const Bucket = yield* Signal.memo([Count], () => Math.floor(Count.value / 10))
          const SawInitial = yield* Deferred.make<void>()
          const ReachedOne = yield* Deferred.make<void>()

          yield* Signal.changes(Bucket).pipe(
            Stream.runForEach((Value) =>
              Effect.gen(function* () {
                Buckets.push(Value)

                if (Value === 0) yield* Deferred.succeed(SawInitial, undefined)

                if (Value === 1) yield* Deferred.succeed(ReachedOne, undefined)
              })
            ),
            Effect.forkScoped
          )

          yield* Deferred.await(SawInitial)
          yield* Count.set(2)
          yield* Count.set(3)
          yield* Count.set(10)
          yield* Deferred.await(ReachedOne)

          expect(Bucket.value).toBe(1)
          expect(Buckets).toEqual([0, 1])
        })
      )
    )
  })

  it("stops recomputing when the owning scope closes", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const Source = yield* Signal.make(0)
        let SelectorRuns = 0

        const Derived = yield* Effect.scoped(
          Effect.gen(function* () {
            return yield* Signal.memo([Source], () => {
              SelectorRuns += 1

              return Source.value
            })
          })
        )

        yield* Source.set(1)

        expect(Derived.value).toBe(0)
        expect(SelectorRuns).toBe(1)
      })
    )
  })

  it("set and update emit through the changes stream", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* Signal.make("a")

          // Wait until the stream emits "c" (works whether it arrives as a live
          // update or as the current value at subscription time).
          const sawC = yield* Deferred.make<void>()
          yield* Signal.changes(signal).pipe(
            Stream.filter((v) => v === "c"),
            Stream.runForEach(() => Deferred.succeed(sawC, undefined)),
            Effect.forkScoped
          )

          yield* signal.set("b")
          yield* signal.update(() => "c")
          yield* Deferred.await(sawC)

          expect(signal.value).toBe("c")
          const current = yield* signal.get
          expect(current).toBe("c")
        })
      )
    )
  })

  it("emits every signal write in order to changes subscribers", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* Signal.make("initial")
          const values: Array<string> = []
          const sawInitial = yield* Deferred.make<void>()
          const sawLastWrite = yield* Deferred.make<void>()

          yield* Signal.changes(signal).pipe(
            Stream.runForEach((value) =>
              Effect.gen(function* () {
                values.push(value)

                if (value === "initial") yield* Deferred.succeed(sawInitial, undefined)

                if (value === "third") yield* Deferred.succeed(sawLastWrite, undefined)
              })
            ),
            Effect.forkScoped
          )

          yield* Deferred.await(sawInitial)
          yield* signal.set("first")
          yield* signal.set("second")
          yield* signal.set("third")
          yield* Deferred.await(sawLastWrite)

          expect(values).toEqual(["initial", "first", "second", "third"])
        })
      )
    )
  })
})
