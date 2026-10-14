import type { Effect } from "effect"
import type { Disposer, Host } from "./Control.js"

/** The fragment marker. `<></>` compiles to `jsx(Fragment, { children })`. */
export const Fragment = Symbol.for("@effect/ui/Fragment")

/**
 * Loosest shape of a component/control so any `Component<P>` / `Control<P>`
 * (which are invariant in `P`) is accepted as a JSX tag. The runtime narrows
 * with the `isComponent` / `isControl` guards, which expose the callable form.
 */
export interface ComponentTag {
  (props: never): Element
  readonly type: "component"
  readonly render: (props: never) => Effect.Effect<Element, unknown, unknown>
}

export interface ControlTag {
  (props: never): Element
  readonly kind: string
  readonly control: (props: never, parent: Node, host: Host, anchor?: Node | null) => Disposer
}

export type ElementType = string | typeof Fragment | ComponentTag | ControlTag

/** A JSX element descriptor produced by the jsx runtime. */
export interface Element {
  readonly type: ElementType
  readonly props: ElementProps
  readonly children: readonly ElementChild[]
}

/**
 * Structural constraint so any `Signal<A>` fits as a child/attribute. A real
 * `Signal` is invariant in `A` (its `set` / `update` write `A`), so no single
 * union member can name it; only the readable `value` is required, which keeps
 * the signal's own variance out of the JSX contract.
 */
export interface SignalChild {
  readonly value: unknown
}

export type ElementChild =
  | Element
  | SignalChild
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly ElementChild[]

/**
 * A conditional class map: a key contributes its name to the `class` attribute
 * when its value is truthy (`{ active: isActive, loading: false }`).
 */
export interface ClassMap {
  readonly [name: string]: boolean | null | undefined
}

/**
 * A `class` / `className` value: a plain string, a `false` / `null` /
 * `undefined` placeholder that contributes no class, a nested array of class
 * values, or a conditional object map.
 */
export type ClassValue = string | boolean | null | undefined | readonly ClassValue[] | ClassMap

export type StyleLike = string | { readonly [K: string]: string | number }

export type Reactive<A> = A | SignalChild

/** Closed Effect action accepted by an event prop without receiving the event. */
export type EffectEventHandler = Effect.Effect<unknown, unknown, never>

/** Native event callbacks may synchronously return or produce a closed Effect. */
export type NativeEventHandler<E extends Event, Target extends EventTarget = EventTarget> = {
  bivarianceHack(
    event: E & { readonly currentTarget: Target }
  ): void | Effect.Effect<unknown, unknown, never>
}["bivarianceHack"]

export type EventHandler<E extends Event = Event, Target extends EventTarget = EventTarget> =
  | EffectEventHandler
  | NativeEventHandler<E, Target>

/** Mutable object reference populated while its native element is mounted. */
export interface RefObject<T> {
  current: T | null
}

/** Ref callbacks are bivariant so a JSX ref keeps the concrete element type. */
export type RefCallback<T extends Node> = {
  bivarianceHack(instance: T | null): void
}["bivarianceHack"]

export type Ref<T extends Node> = RefObject<T> | RefCallback<T>

/** Broad ref shape used inside the renderer after JSX has checked the tag type. */
export type RefAttributeValue = RefObject<unknown> | RefCallback<Node>

/** Creates an object ref for a specific native element type. */
export const createRef = <T extends Node>(): RefObject<T> => ({ current: null })

/**
 * Every value an element prop can carry: children (and their arrays), the
 * reactive class/style/event contracts, and the scalars the DOM host
 * stringifies onto unknown `data-*` / `aria-*` attributes. The values are the
 * ones the host already consumes; anything else never reaches the DOM.
 */
export type ElementAttributeValue =
  | ElementChild
  | ClassValue
  | StyleLike
  | EventHandler
  | RefAttributeValue

type NativeAttributeValue = string | number | boolean | null | undefined

interface IntrinsicCommonProps<E extends Node = Node> {
  children?: ElementChild
  key?: string | number
  class?: Reactive<ClassValue>
  className?: Reactive<ClassValue>
  style?: Reactive<StyleLike>
  id?: Reactive<string>
  value?: Reactive<string | number | null>
  checked?: Reactive<boolean>
  selected?: Reactive<boolean>
  disabled?: Reactive<boolean>
  tabIndex?: Reactive<number>
  htmlFor?: Reactive<string>
  ref?: Ref<E>
}

interface IntrinsicEventProps<Target extends EventTarget> {
  onClick?: EventHandler<MouseEvent, Target>
  onInput?: EventHandler<InputEvent, Target>
  onChange?: EventHandler<Event, Target>
  onSubmit?: EventHandler<SubmitEvent, Target>
  onReset?: EventHandler<Event, Target>
  onFocus?: EventHandler<FocusEvent, Target>
  onBlur?: EventHandler<FocusEvent, Target>
  onDoubleClick?: EventHandler<MouseEvent, Target>
  onKeyDown?: EventHandler<KeyboardEvent, Target>
  onKeyUp?: EventHandler<KeyboardEvent, Target>
  onMouseDown?: EventHandler<MouseEvent, Target>
  onMouseUp?: EventHandler<MouseEvent, Target>
  onMouseMove?: EventHandler<MouseEvent, Target>
  onMouseEnter?: EventHandler<MouseEvent, Target>
  onMouseLeave?: EventHandler<MouseEvent, Target>
  onPointerDown?: EventHandler<PointerEvent, Target>
  onPointerUp?: EventHandler<PointerEvent, Target>
  onPointerMove?: EventHandler<PointerEvent, Target>
  onPointerEnter?: EventHandler<PointerEvent, Target>
  onPointerLeave?: EventHandler<PointerEvent, Target>
  onPointerCancel?: EventHandler<PointerEvent, Target>
  onTouchStart?: EventHandler<TouchEvent, Target>
  onTouchMove?: EventHandler<TouchEvent, Target>
  onTouchEnd?: EventHandler<TouchEvent, Target>
  onTouchCancel?: EventHandler<TouchEvent, Target>
  onContextMenu?: EventHandler<MouseEvent, Target>
  onWheel?: EventHandler<WheelEvent, Target>
  onScroll?: EventHandler<Event, Target>
  onInvalid?: EventHandler<Event, Target>
  onLoad?: EventHandler<Event, Target>
  onError?: EventHandler<Event, Target>
  onCompositionStart?: EventHandler<CompositionEvent, Target>
  onCompositionUpdate?: EventHandler<CompositionEvent, Target>
  onCompositionEnd?: EventHandler<CompositionEvent, Target>
}

type IntrinsicDataProps = {
  [name: `data-${string}`]: Reactive<string | number | boolean | null>
} & {
  [name: `aria-${string}`]: Reactive<string | number | boolean | null>
}

type ForbiddenNativeProps =
  | keyof IntrinsicCommonProps
  | "innerHTML"
  | "outerHTML"
  | "srcdoc"
  | "textContent"

type NativeNameAliases<E> = E extends
  | HTMLFormElement
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement
  ? { autoComplete?: Reactive<string> }
  : {}

/** Native scalar DOM properties adapted for reactive JSX values. */
export type IntrinsicElementProps<E extends Node> = IntrinsicCommonProps<E> &
  IntrinsicEventProps<E> &
  IntrinsicDataProps & {
    [
      Property in keyof E as Property extends string
        ? Property extends ForbiddenNativeProps
          ? never
          : Exclude<E[Property], undefined> extends NativeAttributeValue
            ? Property
            : never
        : never
    ]?: Reactive<Exclude<E[Property], undefined>>
  } & NativeNameAliases<E>

/** Common SVG presentation and geometry attributes absent from lib.dom element properties. */
export interface SvgIntrinsicAttributes {
  viewBox?: Reactive<string>
  preserveAspectRatio?: Reactive<string>
  fill?: Reactive<string>
  fillOpacity?: Reactive<number | string>
  fillRule?: Reactive<string>
  stroke?: Reactive<string>
  strokeWidth?: Reactive<number | string>
  strokeOpacity?: Reactive<number | string>
  strokeLinecap?: Reactive<string>
  strokeLinejoin?: Reactive<string>
  strokeDasharray?: Reactive<string | number>
  strokeDashoffset?: Reactive<string | number>
  clipPath?: Reactive<string>
  clipRule?: Reactive<string>
  cx?: Reactive<number | string>
  cy?: Reactive<number | string>
  d?: Reactive<string>
  points?: Reactive<string>
  r?: Reactive<number | string>
  rx?: Reactive<number | string>
  ry?: Reactive<number | string>
  x?: Reactive<number | string>
  x1?: Reactive<number | string>
  x2?: Reactive<number | string>
  y?: Reactive<number | string>
  y1?: Reactive<number | string>
  y2?: Reactive<number | string>
  transform?: Reactive<string>
  xmlns?: Reactive<string>
}

/** Extensible attributes for custom elements; native elements remain checked. */
export interface CustomElementProps extends IntrinsicCommonProps, IntrinsicEventProps<Node> {
  [attribute: string]: ElementAttributeValue
}

/**
 * Source position the development JSX transform attaches to each element (the
 * 5th `jsxDEV` argument). Members are optional because transforms may omit
 * them for synthetic elements.
 */
export interface JsxSource {
  readonly fileName?: string
  readonly lineNumber?: number
  readonly columnNumber?: number
}

/**
 * The call-site `this` context the development JSX transform appends to every
 * `jsxDEV` call. JSX call sites are ES modules, where top-level `this` is
 * `undefined`; the dev runtime forwards everything to `jsx` and never inspects
 * the value.
 */
export type JsxDevSelf = undefined

export interface ElementProps {
  children?: ElementChild
  key?: string | number
  class?: Reactive<ClassValue>
  className?: Reactive<ClassValue>
  style?: Reactive<StyleLike>
  id?: Reactive<string>
  value?: Reactive<string | number | null>
  checked?: Reactive<boolean>
  selected?: Reactive<boolean>
  disabled?: Reactive<boolean>
  tabIndex?: Reactive<number>
  htmlFor?: Reactive<string>
  onClick?: EventHandler
  onInput?: EventHandler
  onChange?: EventHandler
  onSubmit?: EventHandler
  onReset?: EventHandler
  onFocus?: EventHandler
  onBlur?: EventHandler
  onDoubleClick?: EventHandler
  onKeyDown?: EventHandler
  onKeyUp?: EventHandler
  onMouseDown?: EventHandler
  onMouseUp?: EventHandler
  onMouseMove?: EventHandler
  onMouseEnter?: EventHandler
  onMouseLeave?: EventHandler
  onPointerDown?: EventHandler
  onPointerUp?: EventHandler
  onPointerMove?: EventHandler
  onPointerEnter?: EventHandler
  onPointerLeave?: EventHandler
  onPointerCancel?: EventHandler
  onTouchStart?: EventHandler
  onTouchMove?: EventHandler
  onTouchEnd?: EventHandler
  onTouchCancel?: EventHandler
  onContextMenu?: EventHandler
  onWheel?: EventHandler
  onScroll?: EventHandler
  onInvalid?: EventHandler
  onCompositionStart?: EventHandler
  onCompositionUpdate?: EventHandler
  onCompositionEnd?: EventHandler
  ref?: RefAttributeValue
  [attr: string]: ElementAttributeValue
}

const toChildren = (children: ElementChild | undefined): readonly ElementChild[] => {
  if (children === undefined || children === null) return []

  if (Array.isArray(children)) return children

  return [children]
}

/** `jsx` / `jsxs` — the automatic JSX runtime factory. */
export function jsx(
  type: ElementType,
  props?: ElementProps | null,
  _key?: string | number
): Element {
  return { type, props: props ?? {}, children: toChildren(props?.children) }
}

export const jsxs = jsx

export const isElement = (u: unknown): u is Element =>
  typeof u === "object" && u !== null && "type" in u && "props" in u && "children" in u
