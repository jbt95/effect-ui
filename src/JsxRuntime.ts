import "./Jsx.js"

/**
 * The `jsxImportSource: "@effect/ui"` production runtime entry point. You
 * never import it directly — the JSX transform calls `jsx`/`jsxs` and
 * references `Fragment` on your behalf.
 */
export { Fragment, jsx, jsxs } from "./Element.js"

export type {
  Element,
  ElementProps,
  ElementChild,
  ClassMap,
  ClassValue,
  ElementType,
  StyleLike,
  Reactive,
  EventHandler,
  EffectEventHandler,
  NativeEventHandler,
  Ref,
  RefObject,
  RefCallback,
  IntrinsicElementProps,
  SvgIntrinsicAttributes
} from "./Element.js"
