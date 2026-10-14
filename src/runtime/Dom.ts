export type DomElement = HTMLElement | SVGElement

type NameMap = Readonly<Record<string, string>>

const NameMapValue = (Names: NameMap, Name: string): string | undefined => Names[Name]

export const EVENT_PROP_NAMES = {
  onClick: "click",
  onInput: "input",
  onChange: "change",
  onSubmit: "submit",
  onReset: "reset",
  onFocus: "focus",
  onBlur: "blur",
  onDoubleClick: "dblclick",
  onKeyDown: "keydown",
  onKeyUp: "keyup",
  onMouseDown: "mousedown",
  onMouseUp: "mouseup",
  onMouseMove: "mousemove",
  onMouseEnter: "mouseenter",
  onMouseLeave: "mouseleave",
  onPointerDown: "pointerdown",
  onPointerUp: "pointerup",
  onPointerMove: "pointermove",
  onPointerEnter: "pointerenter",
  onPointerLeave: "pointerleave",
  onPointerCancel: "pointercancel",
  onTouchStart: "touchstart",
  onTouchMove: "touchmove",
  onTouchEnd: "touchend",
  onTouchCancel: "touchcancel",
  onContextMenu: "contextmenu",
  onWheel: "wheel",
  onScroll: "scroll",
  onInvalid: "invalid",
  onLoad: "load",
  onError: "error",
  onCompositionStart: "compositionstart",
  onCompositionUpdate: "compositionupdate",
  onCompositionEnd: "compositionend"
} satisfies NameMap

export const HANDLED_PROPS: ReadonlySet<string> = new Set([
  "children",
  "key",
  "class",
  "className",
  "style",
  "id",
  "ref",
  ...Object.keys(EVENT_PROP_NAMES)
])

const BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected"
])

const BOOLEAN_ATTRIBUTE_PROPERTIES = {
  autofocus: "autofocus",
  autoplay: "autoplay",
  checked: "checked",
  controls: "controls",
  default: "default",
  disabled: "disabled",
  formnovalidate: "formNoValidate",
  hidden: "hidden",
  inert: "inert",
  loop: "loop",
  multiple: "multiple",
  muted: "muted",
  novalidate: "noValidate",
  open: "open",
  playsinline: "playsInline",
  readonly: "readOnly",
  required: "required",
  selected: "selected"
} satisfies NameMap

const DOM_PROPERTIES = {
  checked: "checked",
  defaultChecked: "defaultChecked",
  defaultValue: "defaultValue",
  htmlFor: "htmlFor",
  selected: "selected",
  selectedIndex: "selectedIndex",
  tabIndex: "tabIndex",
  value: "value"
} satisfies NameMap

const BOOLEAN_STYLE_PROPERTIES: ReadonlySet<string> = new Set([
  "animationIterationCount",
  "aspectRatio",
  "borderImageOutset",
  "borderImageSlice",
  "borderImageWidth",
  "boxFlex",
  "boxFlexGroup",
  "boxOrdinalGroup",
  "columnCount",
  "columns",
  "fillOpacity",
  "flex",
  "flexGrow",
  "flexNegative",
  "flexOrder",
  "flexPositive",
  "flexShrink",
  "floodOpacity",
  "fontWeight",
  "gridArea",
  "gridColumn",
  "gridColumnEnd",
  "gridColumnSpan",
  "gridColumnStart",
  "gridRow",
  "gridRowEnd",
  "gridRowSpan",
  "gridRowStart",
  "lineClamp",
  "lineHeight",
  "opacity",
  "order",
  "orphans",
  "scale",
  "stopOpacity",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeMiterlimit",
  "strokeOpacity",
  "strokeWidth",
  "tabSize",
  "widows",
  "zIndex",
  "zoom"
])

const SVG_NAMESPACE = "http://www.w3.org/2000/svg"

export const ownerDocument = (node: Node): Document => node.ownerDocument ?? document

const ATTRIBUTE_NAMES = {
  clipPath: "clip-path",
  clipRule: "clip-rule",
  fillRule: "fill-rule",
  strokeDasharray: "stroke-dasharray",
  strokeDashoffset: "stroke-dashoffset",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  strokeWidth: "stroke-width"
} satisfies NameMap

const UrlAttributeName =
  /^(?:action|cite|data|formaction|href|manifest|poster|src|srcset|xlink:href|xlinkhref)$/i

const SrcdocAttributeName = /^srcdoc$/i

const HtmlContentPropertyName = /^(?:innerhtml|outerhtml|textcontent)$/i

const SrcsetAttributeName = /^srcset$/i

const SrcAttributeName = /^src$/i

const DataAttributeName = /^data$/i

const ScriptTagName = /^(?:[^:]+:)?script$/i

const SvgAnimationTagName = /^(?:[^:]+:)?(?:animate|animatemotion|animatetransform|set|discard)$/i

const DataUrlScheme = /^data:/i

// eslint-disable-next-line no-control-regex -- Strip parser-ignored controls before checking URL schemes.
const UrlSchemeControlCharacters = /[\u0000-\u0020\u007f]/g

const ExecutableUrlScheme = /^(?:javascript|vbscript):/i

const ExecutableUrlInSrcset = /(?:javascript|vbscript):/i

export const renderText = (value: unknown): string => {
  if (value === null || value === undefined || typeof value === "boolean") return ""

  return typeof value === "string" ? value : String(value)
}

const cssPropertyName = (name: string): string => {
  if (name.startsWith("--")) return name
  const kebabCase = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

  return kebabCase.startsWith("ms-") ? `-${kebabCase}` : kebabCase
}

const isUnitlessStyleProperty = (name: string): boolean => {
  if (BOOLEAN_STYLE_PROPERTIES.has(name)) return true
  const unprefixed = name.replace(/^(Webkit|Moz|ms|O)(?=[A-Z])/, "")

  if (unprefixed === name) return false

  return BOOLEAN_STYLE_PROPERTIES.has(`${unprefixed[0].toLowerCase()}${unprefixed.slice(1)}`)
}

const applyStyleObject = (
  dom: DomElement,
  styleValue: Readonly<Record<string, string | number>>
): void => {
  const style = dom.style
  dom.removeAttribute("style")

  for (const [name, value] of Object.entries(styleValue)) {
    const customProperty = name.startsWith("--")

    const cssValue =
      typeof value === "number" && value !== 0 && !customProperty && !isUnitlessStyleProperty(name)
        ? `${value}px`
        : String(value)

    style.setProperty(cssPropertyName(name), cssValue)
  }
}

const isStyleObject = (value: unknown): value is Readonly<Record<string, string | number>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false

  return Object.values(value).every(
    (entry) => typeof entry === "string" || typeof entry === "number"
  )
}

const AppendClassNames = (Value: unknown, Names: Array<string>): void => {
  if (Value === null || Value === undefined || Value === true || Value === false) return

  if (Array.isArray(Value)) {
    for (const Entry of Value) AppendClassNames(Entry, Names)

    return
  }

  if (Object(Value) === Value) {
    for (const [Name, Active] of Object.entries(Object(Value))) {
      if (Active) Names.push(Name)
    }

    return
  }

  Names.push(String(Value))
}

/**
 * Resolve a `class` / `className` prop value into the `class` attribute
 * string. `ElementProps` types those props as `ClassValue`, but JSX is a
 * sanitized boundary that cannot validate runtime input, so this decoder runs
 * before the value reaches the DOM: booleans and nullish entries add no class,
 * nested arrays flatten depth-first, and a conditional map adds a key only when
 * its value is truthy. Other scalars stringify like every other attribute value.
 */
const ResolveClassNames = (Value: unknown): string => {
  const Names: Array<string> = []
  AppendClassNames(Value, Names)

  return Names.join(" ")
}

const applySimpleAttribute = (dom: DomElement, name: "id", value: unknown): void => {
  if (value === null || value === undefined) dom.removeAttribute(name)
  else dom.setAttribute(name, String(value))
}

const applyStyleValue = (dom: DomElement, value: unknown): void => {
  if (value === null || value === undefined) {
    dom.removeAttribute("style")
  } else if (typeof value === "string") {
    dom.setAttribute("style", value)
  } else if (isStyleObject(value)) {
    applyStyleObject(dom, value)
  } else {
    dom.setAttribute("style", String(value))
  }
}

const setDomProperty = (dom: DomElement, name: string, value: unknown): void => {
  Reflect.set(dom, name, value)
}

const clearDomValue = (dom: DomElement, name: string, propertyName: string | undefined): void => {
  if (propertyName !== undefined && propertyName in dom) {
    const resetValue = propertyName === "checked" || propertyName === "selected" ? false : ""
    setDomProperty(dom, propertyName, resetValue)
  }

  dom.removeAttribute(name === "htmlFor" ? "for" : (NameMapValue(ATTRIBUTE_NAMES, name) ?? name))
}

const applyBooleanAttribute = (dom: DomElement, name: string, value: boolean): void => {
  const normalizedName = name.toLowerCase()
  const propertyName = NameMapValue(BOOLEAN_ATTRIBUTE_PROPERTIES, normalizedName)

  if (propertyName !== undefined && propertyName in dom) setDomProperty(dom, propertyName, value)

  if (value) dom.setAttribute(name, "")
  else dom.removeAttribute(name)
}

const applyDomProperty = (
  dom: DomElement,
  name: string,
  propertyName: string,
  value: unknown
): void => {
  setDomProperty(dom, propertyName, value)

  if (name === "htmlFor") dom.setAttribute("for", String(value))
}

const isActiveDocumentUrl = (dom: DomElement, name: string): boolean =>
  (SrcAttributeName.test(name) && ["embed", "frame", "iframe"].includes(dom.localName)) ||
  (DataAttributeName.test(name) && dom.localName === "object")

const rejectExecutableUrl = (dom: DomElement, name: string, normalized: string): void => {
  const executable = SrcsetAttributeName.test(name)
    ? ExecutableUrlInSrcset.test(normalized)
    : ExecutableUrlScheme.test(normalized)

  if (!executable) return

  dom.removeAttribute(NameMapValue(ATTRIBUTE_NAMES, name) ?? name)
  throw new TypeError(`[@effect/ui] executable URL schemes are not allowed in ${name}`)
}

const rejectEmbeddedDataUrl = (dom: DomElement, name: string, normalized: string): void => {
  if (!isActiveDocumentUrl(dom, name) || !DataUrlScheme.test(normalized)) return

  dom.removeAttribute(NameMapValue(ATTRIBUTE_NAMES, name) ?? name)
  throw new TypeError("[@effect/ui] data URLs are not supported in embedded documents")
}

const validateUrlAttribute = (
  dom: DomElement,
  name: string,
  value: unknown
): string | undefined => {
  if (value === null || value === undefined) return undefined

  if (SrcdocAttributeName.test(name)) {
    dom.removeAttribute("srcdoc")
    throw new TypeError("[@effect/ui] the iframe srcdoc attribute is not supported")
  }

  if (!UrlAttributeName.test(name)) return undefined

  const serialized = String(value)
  const normalized = serialized.replace(UrlSchemeControlCharacters, "")
  rejectExecutableUrl(dom, name, normalized)
  rejectEmbeddedDataUrl(dom, name, normalized)

  return serialized
}

const applyOrdinaryAttribute = (dom: DomElement, name: string, value: unknown): void => {
  if (HtmlContentPropertyName.test(name) && value !== null && value !== undefined) {
    dom.removeAttribute(name)
    throw new TypeError("[@effect/ui] raw HTML and text content properties are not supported")
  }

  const SerializedValue = validateUrlAttribute(dom, name, value)

  const propertyName = NameMapValue(DOM_PROPERTIES, name)

  if (value === null || value === undefined) {
    clearDomValue(dom, name, propertyName)
  } else if (typeof value === "boolean" && BOOLEAN_ATTRIBUTES.has(name.toLowerCase())) {
    applyBooleanAttribute(dom, name, value)
  } else if (propertyName !== undefined && propertyName in dom) {
    applyDomProperty(dom, name, propertyName, value)
  } else {
    dom.setAttribute(NameMapValue(ATTRIBUTE_NAMES, name) ?? name, SerializedValue ?? String(value))
  }
}

const applyClassAttribute = (dom: DomElement, value: unknown): void => {
  const ClassNames = ResolveClassNames(value)

  if (ClassNames === "") dom.removeAttribute("class")
  else dom.setAttribute("class", ClassNames)
}

const SpecialAttributeHandlers = new Map<string, (dom: DomElement, value: unknown) => void>([
  ["class", applyClassAttribute],
  ["className", applyClassAttribute],
  ["id", (dom, value) => applySimpleAttribute(dom, "id", value)],
  ["style", applyStyleValue]
])

export const applyAttrValue = (dom: DomElement, name: string, value: unknown): void => {
  const specialAttribute = SpecialAttributeHandlers.get(name)

  if (specialAttribute !== undefined) {
    specialAttribute(dom, value)

    return
  }

  applyOrdinaryAttribute(dom, name, value)
}

export const createDomElement = (type: string, parent: Node): DomElement => {
  if (ScriptTagName.test(type)) {
    throw new TypeError("[@effect/ui] script elements are not supported")
  }

  // SAFETY: Node.nodeType === 1 identifies an Element, the only nodes with an element namespace.
  const parentElement = parent.nodeType === 1 ? (parent as DomElement) : undefined

  const inSvg =
    parentElement?.namespaceURI === SVG_NAMESPACE && parentElement.localName !== "foreignObject"

  if (inSvg && SvgAnimationTagName.test(type)) {
    throw new TypeError("[@effect/ui] SVG animation elements are not supported")
  }

  const doc = ownerDocument(parent)

  return type === "svg" || inSvg
    ? doc.createElementNS(SVG_NAMESPACE, type)
    : doc.createElement(type)
}
