import { Effect } from "effect"
import { local } from "./Component.js"
import { jsx } from "./Element.js"
import type { EventHandler } from "./Element.js"
import { Service, type Provider } from "./Navigation.js"
import { Signal } from "./Signal.js"
import type { LinkProps } from "./router/Link.js"

export type { LinkProps as Props } from "./router/Link.js"

const active = (provider: Provider, props: LinkProps) => {
  const current = new URL(provider.location.value.href)
  const next = new URL(props.to, current)
  const path = next.pathname.replace(/\/$/, "") || "/"
  const here = current.pathname.replace(/\/$/, "") || "/"
  const exact = next.origin === current.origin && path === here

  return {
    exact,
    active:
      next.origin === current.origin &&
      (exact || (!props.end && (path === "/" || here.startsWith(`${path}/`))))
  }
}

const userAction = <E extends Event>(
  handler: EventHandler<E, HTMLAnchorElement> | undefined,
  event: E & { readonly currentTarget: HTMLAnchorElement }
) => {
  if (handler === undefined) return

  return Effect.isEffect(handler) ? handler : handler(event)
}

const nativeClick = (event: MouseEvent & { readonly currentTarget: HTMLAnchorElement }): boolean =>
  event.defaultPrevented ||
  event.button !== 0 ||
  event.metaKey ||
  event.ctrlKey ||
  event.shiftKey ||
  event.altKey ||
  event.currentTarget.hasAttribute("download") ||
  (event.currentTarget.target !== "" && event.currentTarget.target !== "_self")

const isBrowserLocation = (provider: Provider): boolean => {
  try {
    return new URL(provider.location.value.href).origin === window.location.origin
  } catch {
    return true
  }
}

const linkDestinations = (provider: Provider, to: string) => {
  const current = new URL(provider.location.value.href)

  return { current, next: new URL(to, current) }
}

const isDuplicateLink = (current: URL, next: URL): boolean => next.href === current.href

const isNativeHashLink = (provider: Provider, current: URL, next: URL): boolean =>
  next.pathname === current.pathname &&
  next.search === current.search &&
  next.hash !== "" &&
  isBrowserLocation(provider)

const navigateLink = (
  provider: Provider,
  props: LinkProps,
  user: void | Effect.Effect<unknown, unknown, never>,
  event: MouseEvent & { readonly currentTarget: HTMLAnchorElement }
) => {
  event.preventDefault()
  const navigate = provider.navigate(props.to, { replace: props.replace })

  return user === undefined ? navigate : user.pipe(Effect.andThen(navigate))
}

const click =
  (provider: Provider, props: LinkProps) =>
  (event: MouseEvent & { readonly currentTarget: HTMLAnchorElement }) => {
    const user = userAction(props.onClick, event)

    if (nativeClick(event)) return user
    const { current, next } = linkDestinations(provider, props.to)

    if (next.origin !== current.origin) return user

    // Exact duplicate (including hash): run user callbacks without pushing history.
    if (isDuplicateLink(current, next)) {
      event.preventDefault()

      return user
    }

    // Hash-only change: preserve native scrolling for browser-backed locations;
    // memory locations have no native hash to handle, so navigate via provider.
    if (isNativeHashLink(provider, current, next)) return user

    return navigateLink(provider, props, user, event)
  }

const intentHandler =
  <E extends Event>(
    handler: EventHandler<E, HTMLAnchorElement> | undefined,
    intent: Effect.Effect<void, unknown> | undefined
  ) =>
  (event: E & { readonly currentTarget: HTMLAnchorElement }) => {
    const result = userAction(handler, event)

    if (intent === undefined) return result

    return result === undefined ? intent : result.pipe(Effect.andThen(intent))
  }

export const make = Effect.fnUntraced(function* () {
  const provider = yield* Service

  return local((props: LinkProps) =>
    Effect.gen(function* () {
      const state = yield* Signal.memo([provider.location], () => active(provider, props))
      const isActive = yield* Signal.map(state, (value) => (value.active ? "true" : "false"))
      const current = yield* Signal.map(state, (value) => (value.exact ? "page" : undefined))
      const { to, replace: _replace, end: _end, prefetch, onClick: _click, ...attributes } = props
      const intent = prefetch === false ? undefined : provider.prefetch(to)

      return jsx("a", {
        ...attributes,
        href: to,
        "data-active": isActive,
        "aria-current": current,
        onClick: click(provider, props),
        onPointerEnter: intentHandler(props.onPointerEnter, intent),
        onFocus: intentHandler(props.onFocus, intent)
      })
    })
  )
})
