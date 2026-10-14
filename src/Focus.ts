import { Effect } from "effect"
import type { RefObject } from "./Element.js"

const FocusableSelector =
  "a[href], area[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]"

const isFocusable = (element: HTMLElement): boolean =>
  element.tabIndex >= 0 &&
  !element.matches(":disabled") &&
  element.closest("[hidden], [inert], [aria-hidden='true']") === null

/**
 * Focuses the referenced element and reports whether it became the active
 * element. No focus trap or restoration is provided — build those per widget.
 */
export const focus = <T extends HTMLElement>(ref: RefObject<T>): Effect.Effect<boolean> =>
  Effect.sync(() => {
    const element = ref.current

    if (element === null || !isFocusable(element)) return false

    element.focus()

    return element.ownerDocument.activeElement === element
  })

/** Blurs the referenced element only when it currently owns focus. */
export const blur = <T extends HTMLElement>(ref: RefObject<T>): Effect.Effect<boolean> =>
  Effect.sync(() => {
    const element = ref.current

    if (element === null || element.ownerDocument.activeElement !== element) return false

    element.blur()

    return true
  })

/** Focuses and returns the first sequentially focusable descendant of a ref. */
export const focusFirst = <T extends HTMLElement>(
  ref: RefObject<T>
): Effect.Effect<HTMLElement | null> =>
  Effect.sync(() => {
    const container = ref.current

    if (container === null) return null

    for (const element of container.querySelectorAll<HTMLElement>(FocusableSelector)) {
      if (!isFocusable(element)) continue

      element.focus()

      if (element.ownerDocument.activeElement === element) return element
    }

    return null
  })

/** Alias for `focusFirst`. See `Focus.first`. */
export const first = focusFirst
