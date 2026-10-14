import { Deferred, Effect, Fiber, Option, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { ResourceCache } from "../src/ResourceCache.js"
import { type Resource, type ResourceState } from "../src/Resource.js"

const AwaitSuccess = <A, E>(
  ResourceValue: Resource<A, E>
): Effect.Effect<Extract<ResourceState<A, E>, { readonly status: "success" }>> =>
  ResourceValue.changes.pipe(
    Stream.filter(
      (State): State is Extract<ResourceState<A, E>, { readonly status: "success" }> =>
        State.status === "success"
    ),
    Stream.runHead,
    Effect.map(Option.getOrThrow)
  )

describe("ResourceCache", () => {
  it("deduplicates in-flight loads and reuses fresh values per cache", async () => {
    const Loaded = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Cache = yield* ResourceCache.make()
          const Started = yield* Deferred.make<void>()
          const Gate = yield* Deferred.make<string>()
          let Loads = 0

          const Key = ResourceCache.key(
            "shared-profile",
            (Id: string) => Id,
            (Id: string) =>
              Effect.gen(function* () {
                Loads += 1
                yield* Deferred.succeed(Started, undefined)

                const Result = yield* Deferred.await(Gate)

                return { id: Id, name: Result }
              }),
            "5 minutes"
          )

          const First = yield* Cache.get(Key, "ada")

          yield* Deferred.await(Started)

          const Duplicate = yield* Cache.get(Key, "ada")
          expect(Duplicate).toBe(First)
          expect(Loads).toBe(1)

          const Ready = yield* Effect.forkScoped(AwaitSuccess(First))
          yield* Deferred.succeed(Gate, "Ada Lovelace")

          const Value = yield* Fiber.join(Ready)
          const Fresh = yield* Cache.get(Key, "ada")

          expect(Fresh).toBe(First)
          expect(Loads).toBe(1)

          const OtherCache = yield* ResourceCache.make()
          const Isolated = yield* OtherCache.get(Key, "ada")

          return { Value, Isolated, First }
        })
      )
    )

    expect(Loaded.Value.value).toEqual({ id: "ada", name: "Ada Lovelace" })
    expect(Loaded.Isolated).not.toBe(Loaded.First)
  })

  it("refreshes terminal resources after their stale time", async () => {
    const Values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Cache = yield* ResourceCache.make()
          let Loads = 0

          const Key = ResourceCache.key(
            "counter",
            () => "singleton",
            () => Effect.sync(() => (Loads += 1)),
            0
          )

          const First = yield* Cache.get(Key, undefined)
          const FirstSuccess = yield* AwaitSuccess(First)
          const Again = yield* Cache.get(Key, undefined)
          const SecondSuccess = yield* AwaitSuccess(Again)

          return { First, Again, FirstSuccess, SecondSuccess, Loads }
        })
      )
    )

    expect(Values.Again).toBe(Values.First)
    expect(Values.FirstSuccess.value).toBe(1)
    expect(Values.SecondSuccess.value).toBe(2)
    expect(Values.Loads).toBe(2)
  })

  it("invalidates with cancellation, replaces entries, and clears the cache", async () => {
    let Interrupted = false

    const Result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Cache = yield* ResourceCache.make()
          const Started = yield* Deferred.make<void>()
          const Gate = yield* Deferred.make<string>()
          let Loads = 0

          const Key = ResourceCache.key(
            "cancel-profile",
            (Id: string) => Id,
            (Id: string) =>
              Effect.gen(function* () {
                Loads += 1

                if (Loads === 1) {
                  yield* Deferred.succeed(Started, undefined)

                  return yield* Deferred.await(Gate).pipe(
                    Effect.onInterrupt(() => Effect.sync(() => (Interrupted = true)))
                  )
                }

                return `${Id}-${Loads}`
              })
          )

          const Original = yield* Cache.get(Key, "ada")

          yield* Deferred.await(Started)
          yield* Cache.invalidate(Key, "ada")

          const CancelledState = Original.state.value
          const Replacement = yield* Cache.get(Key, "ada")
          const ReplacedValue = yield* AwaitSuccess(Replacement)

          yield* Cache.clear

          const ClearedState = Replacement.state.value
          const AfterClear = yield* Cache.get(Key, "ada")

          return { CancelledState, ClearedState, Original, Replacement, AfterClear, ReplacedValue }
        })
      )
    )

    expect(Result.CancelledState.status).toBe("cancelled")
    expect(Interrupted).toBe(true)
    expect(Result.Replacement).not.toBe(Result.Original)
    expect(Result.ReplacedValue.value).toBe("ada-2")
    expect(Result.ClearedState.status).toBe("cancelled")
    expect(Result.AfterClear).not.toBe(Result.Replacement)
  })
})
