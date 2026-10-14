import { Effect } from "effect"

const TransitionPriority = 10

/**
 * Defers an Effect action to a lower-priority scheduler turn. The action keeps
 * its original success, failure, environment, and interruption behavior.
 */
export const startTransition = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* Effect.yieldNowWith(TransitionPriority)

    return yield* effect
  })
