import { Cause, Effect, Option, Stream } from "effect"
import { Control } from "./Control.js"
import { jsx, type Element, type ElementChild } from "./Element.js"
import type { Resource, ResourceState } from "./Resource.js"
import { fromSource } from "./Signal.js"
import { mountAsync } from "./runtime/Async.js"

/**
 * View options for `Async.View`: how to render a loaded value, what to show
 * while pending, and how to render the full typed `Cause<E>` on failure.
 * `failure` is optional — without it, failures go to `onError` handling.
 */
export interface Options<A, E> {
  readonly success: (value: A) => ElementChild
  readonly pending?: ElementChild
  readonly failure?: (cause: Cause.Cause<E>) => ElementChild
}

/**
 * Props for `Async.View`: a data `Resource` or a closed loading Effect plus
 * view options. Keep loaders data-first — return data, not JSX — so multiple
 * views can share one cached value with different renderers.
 */
export interface Props<A, E> extends Options<A, E> {
  readonly source: Resource<A, E> | Effect.Effect<A, E>
}

const mapResource = <A, E>(
  resource: Resource<A, E>,
  render: (value: A) => ElementChild
): Resource<ElementChild, E> => {
  let cached: { readonly value: A; readonly child: ElementChild } | undefined

  const success = (value: A): ElementChild => {
    if (cached === undefined || !Object.is(cached.value, value))
      cached = { value, child: render(value) }

    return cached.child
  }

  const state = (value: ResourceState<A, E>): ResourceState<ElementChild, E> =>
    value.status === "success"
      ? { status: "success", value: success(value.value) }
      : { ...value, previous: Option.map(value.previous, success) }

  const changes = resource.changes.pipe(Stream.map(state))

  return {
    state: fromSource({
      get: Effect.map(resource.state.get, state),
      get value() {
        return state(resource.state.value)
      },
      changes
    }),
    changes,
    refresh: resource.refresh,
    cancel: resource.cancel
  }
}

/**
 * Builds an async descriptor from a source and view options without JSX.
 * Prefer `<Async.View>` in components; use `view` in helpers that compute
 * props programmatically.
 */
export const view = <A, E>(source: Props<A, E>["source"], options: Options<A, E>): Element => {
  const control = Control.make<{}>("control/async/data", (_props, parent, host, anchor) => {
    const shared = { fallback: options.pending, failure: options.failure }

    return Effect.isEffect(source)
      ? mountAsync({ ...shared, effect: Effect.map(source, options.success) }, parent, host, anchor)
      : mountAsync(
          { ...shared, resource: mapResource(source, options.success) },
          parent,
          host,
          anchor
        )
  })

  return jsx(control, {})
}

const createView = <A, E>(props: Props<A, E>): Element => view(props.source, props)

/**
 * The async-subtree JSX tag. `success` maps each loaded value to DOM and is
 * re-run per distinct value (compared by identity); during `Resource`
 * refresh the last successful DOM instance stays mounted, preserving local
 * edits and focus until changed data succeeds. Removing the subtree
 * interrupts its pending work.
 *
 * ```tsx
 * <Async.View
 *   source={user}
 *   pending={<p role="status">Loading…</p>}
 *   success={(value) => <h1>{value.name}</h1>}
 *   failure={(cause) => <p role="alert">Could not load the profile.</p>}
 * />
 * ```
 */
export const View = Object.assign(createView, {
  type: "component" as const,
  render: (props: never) => Effect.succeed(createView(props))
})
