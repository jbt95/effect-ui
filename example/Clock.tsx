import { Component, Signal } from "@effect/ui"
import { Context, Effect, Layer, Stream } from "effect"

/**
 * A service that runs a background Effect: a 1s ticker whose emissions write a
 * signal. The forked fiber is owned by the layer scope, so disposing the runtime
 * cancels it automatically.
 */
class Clock extends Context.Service<
  Clock,
  {
    readonly now: Signal.Source<string>
  }
>()("Clock") {
  static readonly layer = Layer.effect(
    Clock,
    Effect.gen(function* () {
      const now = yield* Signal.make(currentTime())
      yield* Stream.tick("1 second").pipe(
        Stream.runForEach(() => now.set(currentTime())),
        Effect.forkScoped
      )

      return Clock.of({ now })
    })
  )
}

const currentTime = (): string => new Date().toLocaleTimeString()

const ClockView = Component.make(
  Effect.gen(function* () {
    const clock = yield* Clock

    return () =>
      Effect.succeed(
        <section>
          <h2>Clock</h2>
          <p>Now: {clock.now}</p>
        </section>
      )
  })
)

export { Clock, ClockView }
