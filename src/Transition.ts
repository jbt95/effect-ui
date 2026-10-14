import { Effect } from "effect"

const TransitionPriority = 10

/**
 * Defers an Effect action to a lower-priority scheduler turn. The action
 * keeps its original success, failure, environment, and interruption
 * behavior. This is scheduling, not a DOM animation or deferred rendering.
 */
export const start = Effect.fnUntraced(function* <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.fn.Return<A, E, R> {
  yield* Effect.yieldNowWith(TransitionPriority)

  return yield* effect
})

/** Scheduler-priority transitions. See `Transition.start`. */
export const Transition = { start }

/** @deprecated Use Transition.start. */
export const startTransition = start
