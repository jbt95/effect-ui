import { defineComponent, Signal } from "@effect/ui"
import { Context, Effect, Layer } from "effect"

/**
 * UI state + behavior live in a scoped Effect service. The service owns the
 * signals; components mostly render services.
 */
class Counter extends Context.Service<
  Counter,
  {
    readonly count: Signal<number>
    readonly doubled: Signal<number>
    readonly increment: Effect.Effect<void>
    readonly decrement: Effect.Effect<void>
    readonly reset: Effect.Effect<void>
  }
>()("Counter") {
  // No `Layer.scoped` in v4: `Layer.effect` runs in the layer's scope, so the
  // fiber forked by `Signal.map` lives as long as the service does.
  static readonly layer = Layer.effect(
    Counter,
    Effect.gen(function* () {
      const count = yield* Signal.make(0)
      const doubled = yield* Signal.map(count, (n) => n * 2)

      return Counter.of({
        count,
        doubled,
        increment: count.update((n) => n + 1),
        decrement: count.update((n) => n - 1),
        reset: count.set(0)
      })
    })
  )
}

// Components are `(props) => Effect<Element>`; this one needs no props.
const CounterView = defineComponent(() =>
  Effect.gen(function* () {
    const counter = yield* Counter

    return (
      <section>
        <h2>Counter</h2>
        <p>Count: {counter.count}</p>
        <p>Double: {counter.doubled}</p>
        <button onClick={counter.decrement}>-</button>
        <button onClick={counter.increment}>+</button>
        <button onClick={counter.reset}>Reset</button>
      </section>
    )
  })
)

export { Counter, CounterView }
