/**
 * Deprecated adapters for the pre-redesign flat interface, kept for staged
 * migration. New code must use the module namespaces (`Component`, `Signal`,
 * `Application`, …). Do not mix legacy tags and runtime handles with
 * namespace-based application assembly.
 */
import "./Jsx.js"

export { defineComponent } from "./component/Legacy.js"

export { isComponent } from "./Component.js"

export { Signal } from "./Signal.js"

export type { SignalSource } from "./Signal.js"

export { Resource } from "./Resource.js"

export type { ResourceState, ResourceStateSignal } from "./Resource.js"

export { ResourceCache } from "./ResourceCache.js"

export type { ResourceCacheKey } from "./ResourceCache.js"

export { Http } from "./Http.js"

export type { BrowserHttpLayerOptions } from "./Http.js"

export { Image, ImageLoadError } from "./Image.js"

export type { ImageProps, ImagePreloadOptions } from "./Image.js"

export { Virtualizer, VirtualList, VirtualTable } from "./Virtualizer.js"

export type {
  VirtualKey,
  VirtualRange,
  VirtualListController,
  VirtualListOptions,
  VirtualListRow,
  VirtualListState,
  VirtualListKeyboardEvent,
  VirtualTableController,
  VirtualTableOptions,
  VirtualTableCell,
  VirtualTableRow,
  VirtualTableState,
  VirtualTableKeyboardEvent
} from "./Virtualizer.js"

export { startTransition } from "./Transition.js"

export { focus, blur, focusFirst } from "./Focus.js"

export { Form, createForm } from "./Form.js"

export type { FormField, FormOptions, FormState } from "./Form.js"

export { Fragment, isElement, jsx, jsxs, createRef } from "./Element.js"

export type {
  Element,
  ElementProps,
  ElementChild,
  ElementAttributeValue,
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
  SvgIntrinsicAttributes,
  JsxDevSelf,
  JsxSource,
  ComponentTag,
  ControlTag
} from "./Element.js"

export { Show, For, Async, ErrorBoundary, mount, onCleanup, onMount } from "./Runtime.js"

export type {
  Handle,
  MountOptions,
  ShowProps,
  ForProps,
  AsyncProps,
  ErrorBoundaryProps
} from "./Runtime.js"

export { Navigate, Router } from "./router/Runtime.js"

export { Link } from "./router/Link.js"

export type { LinkProps } from "./router/Link.js"

export type {
  NavigateOptions,
  LazyRouteModule,
  RouteDefinition,
  RouteLocation,
  RouteMetadata,
  RouteMetadataResolver,
  RouteNavigation,
  NavigationKind,
  RouterProps
} from "./Router.js"
