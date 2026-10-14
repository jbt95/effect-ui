import { Cause, Clock, Data, Effect, Exit } from "effect"
import type { Application } from "./Application.js"
import { make } from "./Application.js"
import type { ElementChild } from "./Element.js"
import { scoped, type Mounted, type Options as MountOptions } from "./Mount.js"
import { CreateTextQueries } from "./TestingLegacy.js"

/** Options for `Testing.render`. Services come from Effect composition, not render options. */
export interface Options extends MountOptions {
  readonly container?: HTMLElement
}

/**
 * A mounted test view. Leaving the test scope awaits teardown automatically;
 * yield `close` for explicit early teardown. Text queries are exact-match
 * conveniences, not a full accessible-role query library.
 */
export interface RenderedView extends Mounted {
  readonly getByText: (text: string) => Element
  readonly queryByText: (text: string) => Element | null
}

const isApplication = <E, R>(value: Application<E, R> | ElementChild): value is Application<E, R> =>
  typeof value === "object" && value !== null && "assemble" in value

/**
 * Mounts an application (or closed JSX) into the test's Effect scope and
 * returns container, `close`, and text queries. Every view is scope-owned —
 * there is no global cleanup registry.
 *
 * ```ts
 * const view = yield* Testing.render(App)
 * yield* Testing.fireInput(view.container.querySelector("input")!, "Ada")
 * yield* Testing.waitFor(() => view.getByText("Hello, Ada"))
 * ```
 */
export const render = Effect.fnUntraced(function* <E = never, R = never>(
  app: Application<E, R> | ElementChild,
  options: Options = {}
) {
  const definition = isApplication(app) ? app : make()(Effect.succeed(app))

  const mounted = yield* scoped(
    definition,
    options.container ?? document.createElement("div"),
    options
  )

  return { ...mounted, ...CreateTextQueries(mounted.container) }
})

/** Dispatches a native DOM event, returning the `dispatchEvent` result. */
export const fireEvent = (target: EventTarget, event: Event) =>
  Effect.sync(() => target.dispatchEvent(event))

/** Sets a control's value, then dispatches a bubbling native `input` event. */
export const fireInput = (
  target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
) =>
  Effect.sync(() => {
    target.value = value

    return target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }))
  })

/** Typed `waitFor` timeout. Carries the last assertion failure as `cause`. */
export class WaitForError extends Data.TaggedError("WaitForError")<{
  readonly timeout: number
  readonly cause: unknown
}> {}

/** Polling budget for `waitFor`: total timeout and retry interval. */
export interface WaitForOptions {
  readonly timeout?: number
  readonly interval?: number
}

/**
 * Retries a throwing assertion until it succeeds or the timeout elapses.
 * Only thrown errors retry — returning `false` or `null` is a success.
 */
export const waitFor = Effect.fnUntraced(function* <A>(
  assertion: () => A,
  options: WaitForOptions = {}
) {
  const timeout = options.timeout ?? 1000
  const interval = options.interval ?? 10
  const started = yield* Clock.currentTimeMillis
  let cause: unknown

  while ((yield* Clock.currentTimeMillis) - started <= timeout) {
    const result = yield* Effect.exit(
      Effect.try({ try: assertion, catch: (cause) => new WaitForError({ timeout, cause }) })
    )

    if (Exit.isSuccess(result)) return result.value
    cause = Cause.squash(result.cause)
    yield* Effect.sleep(interval)
  }

  return yield* Effect.fail(new WaitForError({ timeout, cause }))
})
