import { Cause, Clock, Data, Effect, Exit } from "effect"
import type { Application } from "./Application.js"
import { make } from "./Application.js"
import type { ElementChild } from "./Element.js"
import { scoped, type Mounted, type Options as MountOptions } from "./Mount.js"
import { CreateTextQueries } from "./TestingLegacy.js"

export interface Options extends MountOptions {
  readonly container?: HTMLElement
}

export interface RenderedView extends Mounted {
  readonly getByText: (text: string) => Element
  readonly queryByText: (text: string) => Element | null
}

const isApplication = <E, R>(value: Application<E, R> | ElementChild): value is Application<E, R> =>
  typeof value === "object" && value !== null && "assemble" in value

/** Every view is owned by the test's Effect scope; no global cleanup registry is needed. */
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

export const fireEvent = (target: EventTarget, event: Event) =>
  Effect.sync(() => target.dispatchEvent(event))

export const fireInput = (
  target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
) =>
  Effect.sync(() => {
    target.value = value

    return target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }))
  })

export class WaitForError extends Data.TaggedError("WaitForError")<{
  readonly timeout: number
  readonly cause: unknown
}> {}

export interface WaitForOptions {
  readonly timeout?: number
  readonly interval?: number
}

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
