import { Effect, Layer } from "effect"
import type { Scope } from "effect"
import { defineComponent } from "./component/Legacy.js"
import { Fragment, jsx, type ElementChild } from "./Element.js"
import type { Handle } from "./runtime/Mount.js"
import { mount } from "./runtime/Mount.js"

export interface RenderOptions<R = never, E = never> {
  readonly container?: HTMLElement
  readonly layer?: Layer.Layer<Exclude<R, Scope.Scope>, E, never>
  // oxlint-disable-next-line better-antislop/no-unknown-parameters -- runtime failures are arbitrary thrown values.
  readonly onError?: (error: unknown) => void
}

export interface RenderedView {
  readonly container: HTMLElement
  readonly handle: { readonly dispose: () => Promise<void> }
  readonly getByText: (text: string) => Element
  readonly queryByText: (text: string) => Element | null
  readonly unmount: () => Promise<void>
}

const MountedViews = new Set<() => Promise<void>>()

const FindByText = (container: HTMLElement, text: string): Element | null => {
  const expected = text.trim().replace(/\s+/g, " ")
  const candidates = [container, ...container.querySelectorAll("*")]

  return (
    candidates.find((candidate) => {
      const actual = candidate.textContent?.trim().replace(/\s+/g, " ")

      if (actual !== expected) return false

      return !Array.from(candidate.children).some(
        (child) => child.textContent?.trim().replace(/\s+/g, " ") === expected
      )
    }) ?? null
  )
}

export const CreateTextQueries = (
  Container: HTMLElement
): Pick<RenderedView, "getByText" | "queryByText"> => ({
  getByText: (text) => {
    const Match = FindByText(Container, text)

    if (Match === null) throw new Error(`[@effect/ui/testing] Could not find text: ${text}`)

    return Match
  },
  queryByText: (text) => FindByText(Container, text)
})

const CreateUnmount = (HandleValue: Pick<Handle, "dispose">): (() => Promise<void>) => {
  let Disposal: Promise<void> | undefined

  const Unmount = (): Promise<void> => {
    MountedViews.delete(Unmount)
    Disposal ??= HandleValue.dispose()

    return Disposal
  }

  MountedViews.add(Unmount)

  return Unmount
}

/** Mounts one JSX subtree and returns scoped queries plus an awaitable cleanup. */
export function render(
  Child: ElementChild,
  Options?: Omit<RenderOptions<never, never>, "layer"> & { readonly layer?: never }
): RenderedView
export function render<R, E>(
  Child: ElementChild,
  Options: RenderOptions<R, E> & { readonly layer: Layer.Layer<Exclude<R, Scope.Scope>, E, never> }
): RenderedView
export function render(Child: ElementChild, Options: any = {}): RenderedView {
  const Container = Options.container ?? document.createElement("div")

  const HandleValue =
    Options.layer === undefined
      ? mount(
          defineComponent(() => Effect.succeed(jsx(Fragment, { children: Child }))),
          Container,
          Layer.empty,
          { onError: Options.onError }
        )
      : mount(
          defineComponent<{}, any, any>(() => Effect.succeed(jsx(Fragment, { children: Child }))),
          Container,
          Options.layer,
          { onError: Options.onError }
        )

  const Unmount = CreateUnmount(HandleValue)
  const TextQueries = CreateTextQueries(Container)

  return {
    container: Container,
    handle: HandleValue,
    ...TextQueries,
    unmount: Unmount
  }
}

/** Dispatches a native DOM event (`false` means a cancelable event was canceled). */
export const fireEvent = (Target: EventTarget, EventValue: Event): boolean =>
  Target.dispatchEvent(EventValue)

/** Sets a control's current value before dispatching a bubbling native input event. */
export const fireInput = (
  Target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  Value: string
): boolean => {
  Target.value = Value

  return fireEvent(Target, new InputEvent("input", { bubbles: true, inputType: "insertText" }))
}

export interface WaitForOptions {
  readonly timeout?: number
  readonly interval?: number
}

/** Retries an assertion until it returns or throws past the configured timeout. */
export const waitFor = async <A>(Assertion: () => A, Options: WaitForOptions = {}): Promise<A> => {
  const Timeout = Options.timeout ?? 1000
  const Interval = Options.interval ?? 10
  const Started = Date.now()
  let LastError: unknown

  while (Date.now() - Started <= Timeout) {
    try {
      return Assertion()
    } catch (error) {
      LastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, Interval))
  }

  throw new Error(`[@effect/ui/testing] waitFor timed out after ${Timeout}ms`, {
    cause: LastError
  })
}

/** Disposes all currently mounted views and waits for their Effect finalizers. */
export const cleanup = async (): Promise<void> => {
  const Results = await Promise.allSettled(Array.from(MountedViews, (Unmount) => Unmount()))
  const Errors = Results.flatMap((Result) => (Result.status === "rejected" ? [Result.reason] : []))

  if (Errors.length === 1) throw Errors[0]

  if (Errors.length > 1) throw new AggregateError(Errors, "Multiple test views failed to clean up")
}
