import "./Jsx.js"

import { jsx } from "./Element.js"

import type { Element, ElementProps, ElementType, JsxDevSelf, JsxSource } from "./Element.js"

export { Fragment } from "./Element.js"

// esbuild's development automatic runtime calls
// jsxDEV(type, props, key, isStaticChildren, source, self).
export function jsxDEV(
  type: ElementType,
  props: ElementProps | null | undefined,
  _key: string | number | undefined,
  _isStaticChildren: boolean,
  _source?: JsxSource,
  _self?: JsxDevSelf
): Element {
  return jsx(type, props, undefined)
}
