import { Effect } from "effect"
import { defineComponent } from "../Component.js"
import { createRef, jsx } from "../Element.js"
import type { ElementChild, IntrinsicElementProps, NativeEventHandler, Ref } from "../Element.js"
import { onCleanup, onMount } from "../runtime/Lifecycle.js"
import { Navigate, Prefetch } from "../Router.js"
import { RegisterActiveLink } from "./ActiveLinks.js"

export interface LinkProps extends Omit<
  IntrinsicElementProps<HTMLAnchorElement>,
  "children" | "href" | "ref" | "aria-current"
> {
  readonly to: string
  /** Replace the current History entry when this link is followed. */
  readonly replace?: boolean
  /** Match only the exact pathname instead of active descendant paths. */
  readonly end?: boolean
  /** Disable pointer/focus intent prefetching for this link. Defaults to true. */
  readonly prefetch?: boolean
  readonly children?: ElementChild
  readonly ref?: Ref<HTMLAnchorElement>
}

interface LinkStateValue {
  readonly Active: boolean
  readonly Exact: boolean
}

const NormalizePath = (Pathname: string): string =>
  Pathname.length > 1 ? Pathname.replace(/\/+$/, "") : Pathname

const LinkState = (To: string, End: boolean): LinkStateValue => {
  let Destination: URL

  try {
    Destination = new URL(To, window.location.href)
  } catch {
    return { Active: false, Exact: false }
  }

  if (Destination.origin !== window.location.origin) return { Active: false, Exact: false }

  const CurrentPath = NormalizePath(window.location.pathname)
  const DestinationPath = NormalizePath(Destination.pathname)
  const Exact = CurrentPath === DestinationPath

  const Active =
    Exact || (!End && (DestinationPath === "/" || CurrentPath.startsWith(`${DestinationPath}/`)))

  return { Active, Exact }
}

const IsUnmodifiedLeftClick = (EventValue: MouseEvent): boolean =>
  EventValue.button === 0 &&
  !EventValue.defaultPrevented &&
  !EventValue.metaKey &&
  !EventValue.ctrlKey &&
  !EventValue.shiftKey &&
  !EventValue.altKey

const HasNativeAnchorBehavior = (Anchor: HTMLAnchorElement): boolean =>
  Anchor.hasAttribute("download") || (Anchor.target !== "" && Anchor.target !== "_self")

const IsHashOnlyNavigation = (Destination: URL): boolean =>
  IsCurrentPathAndSearch(Destination) && Destination.hash !== window.location.hash

const IsCurrentPathAndSearch = (Destination: URL): boolean =>
  Destination.pathname === window.location.pathname && Destination.search === window.location.search

const CanHandleClick = (
  EventValue: MouseEvent,
  Anchor: HTMLAnchorElement,
  Destination: URL
): boolean =>
  IsUnmodifiedLeftClick(EventValue) &&
  !HasNativeAnchorBehavior(Anchor) &&
  Destination.origin === window.location.origin &&
  !IsHashOnlyNavigation(Destination)

const UserClickAction = (
  Handler: LinkProps["onClick"],
  EventValue: MouseEvent & { readonly currentTarget: HTMLAnchorElement }
): void | Effect.Effect<unknown, unknown, never> => {
  if (Handler === undefined) return

  return Effect.isEffect(Handler) ? Handler : Handler(EventValue)
}

const RunLinkClick = (
  To: string,
  Replace: boolean | undefined,
  Handler: LinkProps["onClick"],
  EventValue: MouseEvent & { readonly currentTarget: HTMLAnchorElement }
): void | Effect.Effect<unknown, unknown, never> => {
  const UserAction = UserClickAction(Handler, EventValue)
  const Destination = ResolveDestination(To)

  if (Destination === undefined) return UserAction

  if (!CanHandleClick(EventValue, EventValue.currentTarget, Destination)) return UserAction

  EventValue.preventDefault()

  if (IsCurrentPathAndSearch(Destination)) return UserAction

  return ContinueNavigation(UserAction, Navigate(To, { replace: Replace }))
}

const ContinueNavigation = (
  UserAction: void | Effect.Effect<unknown, unknown, never>,
  Navigation: Effect.Effect<void>
): void | Effect.Effect<unknown, unknown, never> => {
  if (UserAction === undefined) return Navigation

  return Effect.gen(function* () {
    yield* UserAction
    yield* Navigation
  })
}

const ResolveDestination = (To: string): URL | undefined => {
  try {
    return new URL(To, window.location.href)
  } catch {
    return undefined
  }
}

const IsRefCallback = (
  UserRef: Ref<HTMLAnchorElement>
): UserRef is (Anchor: HTMLAnchorElement | null) => void => typeof UserRef === "function"

const AttachAnchorRef = (
  AnchorRef: ReturnType<typeof createRef<HTMLAnchorElement>>,
  UserRef: Ref<HTMLAnchorElement> | undefined,
  Anchor: HTMLAnchorElement | null
): void => {
  AnchorRef.current = Anchor

  if (UserRef === undefined) return

  if (IsRefCallback(UserRef)) UserRef(Anchor)
  else UserRef.current = Anchor
}

const CreateActiveStateUpdater = (
  AnchorRef: ReturnType<typeof createRef<HTMLAnchorElement>>,
  To: string,
  End: boolean
): (() => void) =>
  function updateActiveState(): void {
    const Anchor = AnchorRef.current

    if (Anchor === null) return

    const { Active, Exact } = LinkState(To, End)
    Anchor.setAttribute("data-active", String(Active))

    if (Exact) Anchor.setAttribute("aria-current", "page")
    else Anchor.removeAttribute("aria-current")
  }

const InstallActiveLink = (Update: () => void) =>
  Effect.gen(function* () {
    let DisposeActiveLink = (): void => {}

    yield* onMount(() => {
      DisposeActiveLink = RegisterActiveLink(Update)
    })

    yield* onCleanup(() => DisposeActiveLink())
  })

const InstallIntentPrefetch = (
  AnchorRef: ReturnType<typeof createRef<HTMLAnchorElement>>,
  To: string,
  Enabled: boolean
) =>
  Effect.gen(function* () {
    let RemoveListeners = (): void => {}

    yield* onMount(() => {
      const Anchor = AnchorRef.current

      if (!Enabled || Anchor === null) return

      const OnIntent = (): void => {
        void Prefetch(To).catch(() => {})
      }

      Anchor.addEventListener("pointerenter", OnIntent)
      Anchor.addEventListener("focus", OnIntent)
      RemoveListeners = () => {
        Anchor.removeEventListener("pointerenter", OnIntent)
        Anchor.removeEventListener("focus", OnIntent)
      }
    })

    yield* onCleanup(() => RemoveListeners())
  })

interface AnchorConfiguration {
  readonly attributes: Omit<LinkProps, "to" | "replace" | "end" | "children" | "ref" | "onClick">
  readonly to: string
  readonly active: boolean
  readonly exact: boolean
  readonly ref: (Anchor: HTMLAnchorElement | null) => void
  readonly onClick: NativeEventHandler<MouseEvent, HTMLAnchorElement>
  readonly children: ElementChild
}

const BuildLinkAnchor = (Configuration: AnchorConfiguration) =>
  jsx("a", {
    ...Configuration.attributes,
    href: Configuration.to,
    ref: Configuration.ref,
    onClick: Configuration.onClick,
    "aria-current": Configuration.exact ? "page" : undefined,
    "data-active": Configuration.active,
    children: Configuration.children
  })

/** Semantic anchor that cooperates with Router and exposes accessible active state. */
const PrepareLinkState = (
  Props: LinkProps,
  AnchorRef: ReturnType<typeof createRef<HTMLAnchorElement>>
) =>
  Effect.gen(function* () {
    yield* InstallActiveLink(CreateActiveStateUpdater(AnchorRef, Props.to, Props.end ?? false))
    yield* InstallIntentPrefetch(AnchorRef, Props.to, Props.prefetch ?? true)

    return LinkState(Props.to, Props.end ?? false)
  })

const RenderLink = (Props: LinkProps) =>
  Effect.gen(function* () {
    const AnchorRef = createRef<HTMLAnchorElement>()
    const State = yield* PrepareLinkState(Props, AnchorRef)

    const {
      to: To,
      replace: Replace,
      ref: UserRef,
      onClick: UserOnClick,
      children: Children,
      ...AnchorProps
    } = Props

    const OnClick: NativeEventHandler<MouseEvent, HTMLAnchorElement> = (EventValue) =>
      RunLinkClick(To, Replace, UserOnClick, EventValue)

    return BuildLinkAnchor({
      attributes: AnchorProps,
      to: To,
      active: State.Active,
      exact: State.Exact,
      ref: (Anchor) => AttachAnchorRef(AnchorRef, UserRef, Anchor),
      onClick: OnClick,
      children: Children
    })
  })

export const Link = defineComponent<LinkProps>(RenderLink)
