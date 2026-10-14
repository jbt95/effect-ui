import { Effect, Fiber } from "effect"
import { describe, expect, it } from "vitest"
import { startTransition } from "../src/Transition.js"

describe("startTransition", () => {
  it("runs the transition after immediate work in a lower-priority turn", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const order: Array<string> = []

          const fiber = yield* Effect.forkScoped(
            startTransition(Effect.sync(() => order.push("transition")))
          )

          order.push("urgent")
          yield* Fiber.join(fiber)

          expect(order).toEqual(["urgent", "transition"])
        })
      )
    )
  })

  it("does not run the deferred action when its fiber is interrupted", async () => {
    let ran = false

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(
            startTransition(
              Effect.sync(() => {
                ran = true
              })
            )
          )

          yield* Fiber.interrupt(fiber)
        })
      )
    )

    expect(ran).toBe(false)
  })
})
