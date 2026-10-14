import { Data, Effect } from "effect"
import { local } from "./Component.js"
import { jsx, type ElementChild, type EventHandler, type IntrinsicElementProps } from "./Element.js"
import { Show } from "./runtime/Controls.js"
import { Signal } from "./Signal.js"

export interface ImageProps extends Omit<
  IntrinsicElementProps<HTMLImageElement>,
  "alt" | "children" | "height" | "loading" | "onError" | "onLoad" | "src" | "width"
> {
  /** Image URL, left to the browser's native request and HTTP cache behavior. */
  readonly src: string
  /** Required alternative text; use an empty string for decorative images. */
  readonly alt: string
  /** Intrinsic width reserves layout space before the image loads. */
  readonly width: number
  /** Intrinsic height reserves layout space before the image loads. */
  readonly height: number
  /** Native browser loading hint; defaults to lazy loading. */
  readonly loading?: "eager" | "lazy"
  /** Wait for `HTMLImageElement.decode()` after the native load event. */
  readonly decode?: boolean
  /** Accessible content shown if loading or decoding fails. */
  readonly fallback?: ElementChild
  readonly onLoad?: EventHandler<Event, HTMLImageElement>
  readonly onError?: EventHandler<Event, HTMLImageElement>
}

export interface ImagePreloadOptions {
  readonly crossOrigin?: string
  readonly referrerPolicy?: ReferrerPolicy
  readonly fetchPriority?: "high" | "low" | "auto"
  /** Decode the loaded image before succeeding. Defaults to true. */
  readonly decode?: boolean
}

export class ImageLoadError extends Data.TaggedError("ImageLoadError")<{
  readonly src: string
  readonly reason: string
}> {}

const RunHandler = (
  Handler: EventHandler<Event, HTMLImageElement> | undefined,
  EventValue: Event & { readonly currentTarget: HTMLImageElement }
): Effect.Effect<void, unknown> => {
  if (Handler === undefined) return Effect.void

  if (Effect.isEffect(Handler)) return Effect.asVoid(Handler)

  const Result = Handler(EventValue)

  return Result === undefined ? Effect.void : Effect.asVoid(Result)
}

const DefaultFallback = (Alt: string): ElementChild =>
  Alt === ""
    ? jsx("span", { "aria-hidden": true, children: "" })
    : jsx("span", {
        role: "img",
        "aria-label": `Image unavailable: ${Alt}`,
        children: "Image unavailable"
      })

const HandleImageError =
  (Failed: Signal<boolean>, UserHandler: ImageProps["onError"]) =>
  (EventValue: Event & { readonly currentTarget: HTMLImageElement }) =>
    Effect.gen(function* () {
      yield* Failed.set(true)
      yield* RunHandler(UserHandler, EventValue)
    })

const CaptureImageEvent = (EventValue: Event & { readonly currentTarget: HTMLImageElement }) => {
  const ImageElement = EventValue.currentTarget

  return new Proxy(EventValue, {
    get(Target, Key) {
      if (Key === "currentTarget") return ImageElement

      // oxlint-disable-next-line better-antislop/no-reflect-get -- Native Event getters must receive the original event, not the proxy.
      const Value = Reflect.get(Target, Key, Target)

      // oxlint-disable-next-line better-antislop/no-runtime-typeof -- Native Event methods must also retain their original receiver.
      return typeof Value === "function" ? Value.bind(Target) : Value
    },
    // WebIDL setters such as returnValue and cancelBubble also require the native receiver.
    set: (Target, Key, Value) => Reflect.set(Target, Key, Value, Target)
  })
}

const HandleImageLoad = (
  Decode: boolean,
  Failed: Signal<boolean>,
  UserLoadHandler: ImageProps["onLoad"],
  UserErrorHandler: ImageProps["onError"]
) => {
  const HandleError = HandleImageError(Failed, UserErrorHandler)

  return (EventValue: Event & { readonly currentTarget: HTMLImageElement }) => {
    if (!Decode) return RunHandler(UserLoadHandler, EventValue)

    const CapturedEvent = CaptureImageEvent(EventValue)

    return Effect.tryPromise({
      try: () => CapturedEvent.currentTarget.decode(),
      catch: () => undefined
    }).pipe(
      Effect.matchEffect({
        onFailure: () => HandleError(CapturedEvent),
        onSuccess: () => RunHandler(UserLoadHandler, CapturedEvent)
      })
    )
  }
}

const NativeImageAttributes = (Props: ImageProps, Failed: Signal<boolean>) => {
  const {
    fallback: _Fallback,
    decode: Decode = false,
    onLoad: OnLoadHandler,
    onError: OnErrorHandler,
    ...ImageAttributes
  } = Props

  const HandleError = HandleImageError(Failed, OnErrorHandler)

  return {
    ...ImageAttributes,
    loading: Props.loading ?? "lazy",
    onLoad: HandleImageLoad(Decode, Failed, OnLoadHandler, OnErrorHandler),
    onError: HandleError
  }
}

const ImageView = (Props: ImageProps, Failed: Signal<boolean>) =>
  jsx(Show, {
    when: Failed,
    fallback: jsx("img", NativeImageAttributes(Props, Failed)),
    children: Props.fallback ?? DefaultFallback(Props.alt)
  })

/**
 * Renders the accessible native image as an Effect descriptor. Prefer the
 * `<Image.View>` tag in JSX; use `make` when computing props
 * programmatically.
 */
export const make = Effect.fnUntraced(function* (Props: ImageProps) {
  const Failed = yield* Signal.make(false)

  return ImageView(Props, Failed)
})

const LoadNativeImage = (Src: string, Options: ImagePreloadOptions): Promise<HTMLImageElement> =>
  new Promise((Resolve, Reject) => {
    const Preloaded = new window.Image()
    const OnLoad = (): void => Resolve(Preloaded)
    const OnError = (): void => Reject()

    Preloaded.addEventListener("load", OnLoad, { once: true })
    Preloaded.addEventListener("error", OnError, { once: true })

    if (Options.crossOrigin !== undefined) Preloaded.crossOrigin = Options.crossOrigin

    if (Options.referrerPolicy !== undefined) Preloaded.referrerPolicy = Options.referrerPolicy

    if (Options.fetchPriority !== undefined) Preloaded.fetchPriority = Options.fetchPriority
    Preloaded.src = Src

    if (Preloaded.complete) {
      if (Preloaded.naturalWidth > 0) Resolve(Preloaded)
      else Reject()
    }
  })

/**
 * Preloads an image through the browser loader and HTTP cache, decoding it
 * unless `decode: false`. Fails with `ImageLoadError`; no separate byte
 * cache is maintained.
 */
export const preload = (
  Src: string,
  Options: ImagePreloadOptions = {}
): Effect.Effect<HTMLImageElement, ImageLoadError> =>
  Effect.tryPromise({
    try: async () => {
      const Preloaded = await LoadNativeImage(Src, Options)

      if (Options.decode !== false) await Preloaded.decode()

      return Preloaded
    },
    catch: () => new ImageLoadError({ src: Src, reason: "Image failed to load or decode" })
  })

const ImageComponent = local(make)

/**
 * Accessible native-image component with intrinsic sizing and explicit
 * preload support. Requires meaningful `alt` (or `alt=""` for decoration)
 * plus `width`/`height` to reserve layout space; lazy-loads by default.
 */
export const Image = Object.assign(ImageComponent, { make, preload })

/** The native-image JSX tag. See `Image`. */
export const View = Image
