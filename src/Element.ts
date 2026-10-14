import type { Effect } from "effect"
import type { Disposer, Host } from "./Control.js"
import type { Local } from "./Component.js"
import type { Source } from "./Signal.js"

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

/** Anything usable as a JSX tag: intrinsics, fragments, components, and controls. */
export type ElementType = string | typeof Fragment | ComponentTag | ControlTag

/**
 * Ordinary JSX accepts only tags with already-acquired application
 * dependencies. A component whose renderer still requires application
 * services is not a valid JSX tag — acquire it with `Component.make` first.
 */
export interface ClosedComponentTag {
  (props: never): Element
  readonly type: "component"
  readonly render: (props: never) => Effect.Effect<Element, unknown, Local>
}

/** The tag union enforced by the JSX transform. See `ClosedComponentTag`. */
export type ClosedElementType = string | typeof Fragment | ClosedComponentTag | ControlTag

/** A JSX element descriptor produced by the jsx runtime. Plain data, not a DOM node. */
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
/**
 * A child-level reactive value: a `Source` of text-compatible scalars.
 * Because `Source` is covariant, any readable source of these scalars fits —
 * while a `Source` of any other type is rejected, so wrongly typed signals
 * fail compilation instead of rendering `[object Object]`.
 */
export type SignalChild = Source<string | number | boolean | null | undefined>

/**
 * Anything renderable as a child: descriptors, text/scalars, reactive
 * sources, nested arrays, and empty values (`null`, `undefined`, booleans
 * render nothing).
 */
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

/**
 * Either a static value or a reactive `Source` of that value. Native scalar
 * props keep their type inside `Reactive`, so a string source cannot fill a
 * boolean prop.
 */
export type Reactive<A> = A | Source<A>

/** A closed Effect action accepted by an event prop without receiving the event. */
export type EffectEventHandler = Effect.Effect<unknown, unknown, never>

/**
 * Native event callbacks receive the concrete event with a typed
 * `currentTarget` and may return `void` or a closed Effect. Capture any
 * needed values synchronously: the event must not escape into async work.
 */
export type NativeEventHandler<E extends Event, Target extends EventTarget = EventTarget> = {
  bivarianceHack(
    event: E & { readonly currentTarget: Target }
  ): void | Effect.Effect<unknown, unknown, never>
}["bivarianceHack"]

/**
 * An event handler: either a closed Effect run when the event fires, or a
 * native callback receiving the event. Synchronous throws and Effect
 * failures go to the nearest `ErrorBoundary` or mount-level `onError`;
 * running Effects are interrupted when their element is disposed.
 */
export type EventHandler<E extends Event = Event, Target extends EventTarget = EventTarget> =
  | EffectEventHandler
  | NativeEventHandler<E, Target>

/** Mutable object reference populated while its native element is mounted. Cleared on disposal. */
export interface RefObject<T> {
  current: T | null
}

/** Ref callbacks are bivariant so a JSX ref keeps the concrete element type. */
export type RefCallback<T extends Node> = {
  bivarianceHack(instance: T | null): void
}["bivarianceHack"]

/** An element ref: an object ref populated on mount, or a callback receiving the element (and `null` on disposal). */
export type Ref<T extends Node> = RefObject<T> | RefCallback<T>

/** Broad ref shape used inside the renderer after JSX has checked the tag type. */
export type RefAttributeValue = RefObject<unknown> | RefCallback<Node>

/** Creates an object ref for a specific native element type. Prefer `Ref.make`. */
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
  | Source<unknown>

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

/**
 * Untyped element props accepted after tag-level checking (intrinsics use
 * the narrower `IntrinsicElementProps`). Raw markup sinks (`innerHTML`,
 * `outerHTML`, `textContent`, `srcdoc`) are deliberately absent.
 */
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

/**
 * The automatic JSX runtime factory (`jsxImportSource: "@effect/ui"`).
 * Splits `children` out of props into the descriptor's child list.
 */
export function jsx(
  type: ElementType,
  props?: ElementProps | null,
  _key?: string | number
): Element {
  return { type, props: props ?? {}, children: toChildren(props?.children) }
}

/** Static-children JSX factory. Identical to `jsx`; kept for transform compatibility. */
export const jsxs = jsx

// oxlint-disable-next-line better-antislop/no-unknown-parameters -- JSX decoding is a runtime protocol guard.
/** Type guard recognizing JSX element descriptors produced by `jsx`. */
export const isElement = (u: unknown): u is Element =>
  typeof u === "object" && u !== null && "type" in u && "props" in u && "children" in u
