import { Deferred, Effect, Fiber, Option, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { Resource, type Resource as ResourceType, type ResourceState } from "../src/Resource.js"

const AwaitState = <A, E, S extends ResourceState<A, E>["status"]>(
  ResourceValue: ResourceType<A, E>,
  Status: S
): Effect.Effect<Extract<ResourceState<A, E>, { readonly status: S }>> =>
  ResourceValue.changes.pipe(
    Stream.filter(
      (State): State is Extract<ResourceState<A, E>, { readonly status: S }> =>
        State.status === Status
    ),
    Stream.runHead,
    Effect.map(Option.getOrThrow)
  )

describe("Resource", () => {
  it("starts pending and publishes its successful value", async () => {
    const Loaded = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Result = yield* Deferred.make<number>()
          const ResourceValue = yield* Resource.make(Deferred.await(Result))
          const Ready = yield* Effect.forkScoped(AwaitState(ResourceValue, "success"))

          expect(ResourceValue.state.value.status).toBe("pending")
          yield* Deferred.succeed(Result, 42)

          return yield* Fiber.join(Ready)
        })
      )
    )

    expect(Loaded).toEqual({ status: "success", value: 42 })
  })

  it("retains the previous value after a failed refresh and can retry", async () => {
    const States = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let Attempts = 0

          const Load = Effect.suspend(() => {
            Attempts += 1

            return Attempts === 2 ? Effect.fail("network unavailable") : Effect.succeed(Attempts)
          })

          const ResourceValue = yield* Resource.make(Load)
          const Initial = yield* AwaitState(ResourceValue, "success")
          const Failed = yield* Effect.forkScoped(AwaitState(ResourceValue, "failure"))

          yield* ResourceValue.refresh

          const Failure = yield* Fiber.join(Failed)
          const Retried = yield* Effect.forkScoped(AwaitState(ResourceValue, "success"))

          yield* ResourceValue.refresh

          const Success = yield* Fiber.join(Retried)

          return { Initial, Failure, Success }
        })
      )
    )

    expect(States.Initial).toEqual({ status: "success", value: 1 })
    expect(States.Failure.status).toBe("failure")

    if (States.Failure.status === "failure") {
      expect(States.Failure.cause.reasons).toHaveLength(1)
      expect(States.Failure.previous).toEqual(Option.some(1))
    }

    expect(States.Success).toEqual({ status: "success", value: 3 })
  })

  it("interrupts an active load when cancelled", async () => {
    let Interrupted = false

    const Cancelled = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Started = yield* Deferred.make<void>()

          const ResourceValue = yield* Resource.make(
            Effect.gen(function* () {
              yield* Deferred.succeed(Started, undefined)

              return yield* Effect.never.pipe(
                Effect.onInterrupt(() => Effect.sync(() => (Interrupted = true)))
              )
            })
          )

          yield* Deferred.await(Started)
          yield* ResourceValue.cancel

          return ResourceValue.state.value
        })
      )
    )

    expect(Cancelled.status).toBe("cancelled")
    expect(Interrupted).toBe(true)
  })
})
