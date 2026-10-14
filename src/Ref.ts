import { createRef } from "./Element.js"
import type { Ref as RefValue, RefCallback, RefObject } from "./Element.js"

/**
 * Declares an object ref for a native element type. Assignment on insertion
 * and clearing on disposal belong to the mounted DOM scope.
 */
export const make = createRef

/** An element ref: an object ref populated on mount, or a callback receiving the element (and `null` on disposal). */
export type Ref<T extends Node> = RefValue<T>

export type { RefCallback, RefObject }

/** Native-element refs. See `Ref.make`. */
export const Ref = { make }
