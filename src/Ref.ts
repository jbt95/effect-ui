import { createRef } from "./Element.js"
import type { Ref as RefValue, RefCallback, RefObject } from "./Element.js"

/** Pure ref declaration. Assignment and clearing belong to the mounted DOM scope. */
export const make = createRef

export type Ref<T extends Node> = RefValue<T>

export type { RefCallback, RefObject }

export const Ref = { make }
