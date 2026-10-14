import { Effect, Scope } from "effect"
import { Signal, type Source } from "./Signal.js"
import {
  FixedRange,
  KeyToken,
  NormalizeScrollOffset,
  ValidateIdentity,
  ValidateOverscan,
  ValidatePositiveSize,
  ValidateVirtualKeys,
  type VirtualKey,
  type VirtualRange
} from "./virtualization/Window.js"

export interface VirtualListOptions<A> {
  /** Stable DOM id used for the listbox and its active option. */
  readonly id: string
  /** Accessible name for the composite listbox. */
  readonly ariaLabel: string
  readonly items: ReadonlyArray<A>
  /** Must return a unique string or finite number for every item. */
  readonly keyOf: (item: A) => VirtualKey
  readonly itemSize: number
  readonly viewportSize: number
  readonly overscan?: number
}

export interface VirtualListRow<A> {
  readonly key: VirtualKey
  readonly id: string
  readonly item: A
  readonly index: number
  readonly start: number
  readonly active: boolean
}

export interface VirtualListState<A> {
  readonly rows: ReadonlyArray<VirtualListRow<A>>
  readonly range: VirtualRange
  readonly activeIndex: number
  readonly activeDescendant: string | undefined
  readonly scrollOffset: number
  readonly viewportSize: number
}

export interface VirtualListKeyboardEvent {
  readonly key: string
  readonly preventDefault: () => void
}

export interface VirtualList<A> {
  readonly id: string
  readonly role: "listbox"
  readonly tabIndex: 0
  readonly ariaLabel: string
  readonly itemCount: number
  readonly totalSize: number
  readonly state: Source<VirtualListState<A>>
  readonly rows: Source<ReadonlyArray<VirtualListRow<A>>>
  readonly range: Source<VirtualRange>
  readonly activeIndex: Source<number>
  readonly activeDescendant: Source<string | undefined>
  readonly attributes: {
    readonly id: string
    readonly role: "listbox"
    readonly tabIndex: 0
    readonly "aria-label": string
    readonly "aria-activedescendant": Source<string | undefined>
  }
  readonly optionAttributes: (row: VirtualListRow<A>) => {
    readonly id: string
    readonly role: "option"
    readonly "aria-selected": boolean
    readonly "aria-posinset": number
    readonly "aria-setsize": number
  }
  /** Recompute the visible rows after a scroll; pass the current viewport size. */
  readonly onScroll: (scrollOffset: number, viewportSize?: number) => Effect.Effect<void>
  /** Update geometry after the viewport is resized. */
  readonly resize: (viewportSize: number) => Effect.Effect<void>
  /** Handle listbox Arrow, Home, End, and page-navigation keys. */
  readonly onKeyDown: (event: VirtualListKeyboardEvent) => Effect.Effect<number | undefined>
  /** Set the active row and return a scroll offset if it needs to move. */
  readonly setActive: (index: number) => Effect.Effect<number | undefined>
}

const OptionId = (Id: string, Key: VirtualKey): string => `${Id}-option-${KeyToken(Key)}`

const ReuseOrCreateRow = <A>(
  Previous: VirtualListRow<A> | undefined,
  Id: string,
  Key: VirtualKey,
  Item: A,
  Index: number,
  Start: number,
  Active: boolean
): VirtualListRow<A> => {
  if (
    Previous !== undefined &&
    Previous.item === Item &&
    Previous.index === Index &&
    Previous.start === Start &&
    Previous.active === Active
  ) {
    return Previous
  }

  return { key: Key, id: OptionId(Id, Key), item: Item, index: Index, start: Start, active: Active }
}

const BuildRows = <A>(
  Id: string,
  Items: ReadonlyArray<A>,
  Keys: ReadonlyArray<VirtualKey>,
  Range: VirtualRange,
  ActiveIndex: number,
  ItemSize: number,
  PreviousRows: ReadonlyArray<VirtualListRow<A>>
): ReadonlyArray<VirtualListRow<A>> => {
  const PreviousByKey = new Map(PreviousRows.map((Row) => [Row.key, Row]))
  const Rows: Array<VirtualListRow<A>> = []

  for (let Index = Range.start; Index < Range.end; Index += 1) {
    const Key = Keys[Index]
    const Item = Items[Index]
    const Start = Index * ItemSize
    const Active = Index === ActiveIndex
    Rows.push(ReuseOrCreateRow(PreviousByKey.get(Key), Id, Key, Item, Index, Start, Active))
  }

  return Rows
}

const ActiveInRange = (Index: number, Range: VirtualRange, Count: number): number => {
  if (Count === 0) return -1

  return Math.max(Range.start, Math.min(Index, Math.max(Range.start, Range.end - 1)))
}

interface ListGeometry {
  readonly range: VirtualRange
  readonly activeIndex: number
  readonly scrollOffset: number
}

interface ListData<A> {
  readonly id: string
  readonly items: ReadonlyArray<A>
  readonly keys: ReadonlyArray<VirtualKey>
  readonly itemSize: number
  readonly overscan: number
}

interface ListWindow {
  readonly scrollOffset: number
  readonly viewportSize: number
  readonly activeIndex: number
}

const CalculateListGeometry = (
  Count: number,
  ItemSize: number,
  ViewportSize: number,
  Overscan: number,
  ScrollOffset: number,
  ActiveIndex: number
): ListGeometry => {
  const Range = FixedRange(Count, ItemSize, ViewportSize, ScrollOffset, Overscan)
  const VisibleRange = FixedRange(Count, ItemSize, ViewportSize, ScrollOffset, 0)

  return {
    range: Range,
    activeIndex: ActiveInRange(ActiveIndex, VisibleRange, Count),
    scrollOffset: NormalizeScrollOffset(ScrollOffset, Count * ItemSize, ViewportSize)
  }
}

const ActiveOptionId = <A>(Data: ListData<A>, ActiveIndex: number): string | undefined => {
  if (ActiveIndex < 0) return undefined

  return OptionId(Data.id, Data.keys[ActiveIndex])
}

const CreateListState = <A>(
  Geometry: ListGeometry,
  Rows: ReadonlyArray<VirtualListRow<A>>,
  ActiveDescendant: string | undefined,
  ViewportSize: number
): VirtualListState<A> => ({
  rows: Rows,
  range: Geometry.range,
  activeIndex: Geometry.activeIndex,
  activeDescendant: ActiveDescendant,
  scrollOffset: Geometry.scrollOffset,
  viewportSize: ViewportSize
})

const BuildState = <A>(
  Data: ListData<A>,
  Window: ListWindow,
  PreviousRows: ReadonlyArray<VirtualListRow<A>>
): VirtualListState<A> => {
  const Geometry = CalculateListGeometry(
    Data.items.length,
    Data.itemSize,
    Window.viewportSize,
    Data.overscan,
    Window.scrollOffset,
    Window.activeIndex
  )

  const Rows = BuildRows(
    Data.id,
    Data.items,
    Data.keys,
    Geometry.range,
    Geometry.activeIndex,
    Data.itemSize,
    PreviousRows
  )

  return CreateListState(
    Geometry,
    Rows,
    ActiveOptionId(Data, Geometry.activeIndex),
    Window.viewportSize
  )
}

const EnsureFixedItemVisible = (
  Index: number,
  ItemSize: number,
  ViewportSize: number,
  CurrentOffset: number
): number => {
  const ItemStart = Index * ItemSize
  const ItemEnd = ItemStart + ItemSize

  if (ItemStart < CurrentOffset) return ItemStart

  if (ItemEnd > CurrentOffset + ViewportSize) return Math.max(0, ItemEnd - ViewportSize)

  return CurrentOffset
}

const ActivateListIndex = <A>(
  Runtime: ListRuntime<A>,
  Current: VirtualListState<A>,
  Index: number
): Effect.Effect<number | undefined> => {
  const ScrollOffset = EnsureFixedItemVisible(
    Index,
    Runtime.Options.itemSize,
    Current.viewportSize,
    Current.scrollOffset
  )

  return UpdateListState(Runtime, ScrollOffset, Current.viewportSize, Index).pipe(
    Effect.as(ScrollOffset === Current.scrollOffset ? undefined : ScrollOffset)
  )
}

const KeyboardIndex = (
  Key: string,
  ActiveIndex: number,
  Count: number,
  PageSize: number
): number | undefined => {
  if (Count === 0) return undefined

  if (Key === "ArrowDown") return Math.min(Count - 1, Math.max(0, ActiveIndex + 1))

  if (Key === "ArrowUp") return Math.max(0, ActiveIndex < 0 ? 0 : ActiveIndex - 1)

  if (Key === "Home") return 0

  if (Key === "End") return Count - 1

  if (Key === "PageDown") return Math.min(Count - 1, Math.max(0, ActiveIndex) + PageSize)

  if (Key === "PageUp") return Math.max(0, Math.max(0, ActiveIndex) - PageSize)

  return undefined
}

const ValidateOptions = <A>(Options: VirtualListOptions<A>): void => {
  ValidateIdentity(Options.id, "virtual list id")

  if (Options.ariaLabel.trim().length === 0) {
    throw new TypeError("[@effect/ui] virtual list ariaLabel must not be empty")
  }

  ValidatePositiveSize(Options.itemSize, "virtual list itemSize")
  ValidatePositiveSize(Options.viewportSize, "virtual list viewportSize")
  ValidateOverscan(Options.overscan ?? 2)
}

interface ListRuntime<A> {
  readonly Options: VirtualListOptions<A>
  readonly Items: ReadonlyArray<A>
  readonly Keys: ReadonlyArray<VirtualKey>
  readonly State: Signal<VirtualListState<A>>
  readonly Lifetime: { disposed: boolean }
}

interface ListSignals<A> {
  readonly Rows: Source<ReadonlyArray<VirtualListRow<A>>>
  readonly Range: Source<VirtualRange>
  readonly ActiveIndex: Source<number>
  readonly ActiveDescendant: Source<string | undefined>
}

const ListAttributes = <A>(
  Options: VirtualListOptions<A>,
  ActiveDescendant: Source<string | undefined>
): VirtualList<A>["attributes"] => ({
  id: Options.id,
  role: "listbox",
  tabIndex: 0,
  "aria-label": Options.ariaLabel,
  "aria-activedescendant": ActiveDescendant
})

const ActiveWithinViewport = (
  Count: number,
  ItemSize: number,
  ScrollOffset: number,
  ViewportSize: number,
  CurrentActive: number
): number => {
  if (Count === 0) return -1

  const Range = FixedRange(Count, ItemSize, ViewportSize, ScrollOffset, 0)

  return Math.max(Range.start, Math.min(CurrentActive, Math.max(Range.start, Range.end - 1)))
}

const UpdateListState = <A>(
  Runtime: ListRuntime<A>,
  ScrollOffset: number,
  ViewportSize: number,
  ActiveIndex: number
): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (Runtime.Lifetime.disposed) return Effect.void

    ValidatePositiveSize(ViewportSize, "virtual list viewportSize")
    const Current = Runtime.State.value

    const Next = BuildState(
      {
        id: Runtime.Options.id,
        items: Runtime.Items,
        keys: Runtime.Keys,
        itemSize: Runtime.Options.itemSize,
        overscan: Runtime.Options.overscan ?? 2
      },
      { scrollOffset: ScrollOffset, viewportSize: ViewportSize, activeIndex: ActiveIndex },
      Current.rows
    )

    return Runtime.State.set(Next)
  })

const SetListActive = <A>(
  Runtime: ListRuntime<A>,
  Index: number
): Effect.Effect<number | undefined> =>
  Effect.suspend(() => {
    if (Runtime.Lifetime.disposed || Runtime.Items.length === 0) return Effect.succeed(undefined)

    if (!Number.isFinite(Index))
      throw new RangeError("[@effect/ui] virtual list index must be finite")

    const Current = Runtime.State.value
    const Target = Math.max(0, Math.min(Runtime.Items.length - 1, Math.trunc(Index)))

    return ActivateListIndex(Runtime, Current, Target)
  })

const OnListScroll = <A>(
  Runtime: ListRuntime<A>,
  ScrollOffset: number,
  ViewportSize?: number
): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (Runtime.Lifetime.disposed) return Effect.void

    const Current = Runtime.State.value
    const Size = ViewportSize ?? Current.viewportSize
    ValidatePositiveSize(Size, "virtual list viewportSize")

    const ActiveIndex = ActiveWithinViewport(
      Runtime.Items.length,
      Runtime.Options.itemSize,
      ScrollOffset,
      Size,
      Current.activeIndex
    )

    return UpdateListState(Runtime, ScrollOffset, Size, ActiveIndex)
  })

const ResizeList = <A>(Runtime: ListRuntime<A>, ViewportSize: number): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (Runtime.Lifetime.disposed) return Effect.void

    const Current = Runtime.State.value
    ValidatePositiveSize(ViewportSize, "virtual list viewportSize")

    const ActiveIndex = ActiveWithinViewport(
      Runtime.Items.length,
      Runtime.Options.itemSize,
      Current.scrollOffset,
      ViewportSize,
      Current.activeIndex
    )

    return UpdateListState(Runtime, Current.scrollOffset, ViewportSize, ActiveIndex)
  })

const OnListKeyDown = <A>(
  Runtime: ListRuntime<A>,
  EventValue: VirtualListKeyboardEvent
): Effect.Effect<number | undefined> =>
  Effect.suspend(() => {
    if (Runtime.Lifetime.disposed) return Effect.succeed(undefined)

    const Current = Runtime.State.value
    const PageSize = Math.max(1, Math.floor(Current.viewportSize / Runtime.Options.itemSize))

    const Target = KeyboardIndex(
      EventValue.key,
      Current.activeIndex,
      Runtime.Items.length,
      PageSize
    )

    if (Target === undefined) return Effect.succeed(undefined)

    EventValue.preventDefault()

    return ActivateListIndex(Runtime, Current, Target)
  })

const CreateListController = <A>(
  Runtime: ListRuntime<A>,
  Signals: ListSignals<A>
): VirtualList<A> => ({
  id: Runtime.Options.id,
  role: "listbox",
  tabIndex: 0,
  ariaLabel: Runtime.Options.ariaLabel,
  itemCount: Runtime.Items.length,
  totalSize: Runtime.Items.length * Runtime.Options.itemSize,
  state: Runtime.State,
  rows: Signals.Rows,
  range: Signals.Range,
  activeIndex: Signals.ActiveIndex,
  activeDescendant: Signals.ActiveDescendant,
  attributes: ListAttributes(Runtime.Options, Signals.ActiveDescendant),
  optionAttributes: (Row) => ({
    id: Row.id,
    role: "option",
    "aria-selected": Row.active,
    "aria-posinset": Row.index + 1,
    "aria-setsize": Runtime.Items.length
  }),
  onScroll: (ScrollOffset, ViewportSize) => OnListScroll(Runtime, ScrollOffset, ViewportSize),
  resize: (ViewportSize) => ResizeList(Runtime, ViewportSize),
  onKeyDown: (EventValue) => OnListKeyDown(Runtime, EventValue),
  setActive: (Index) => SetListActive(Runtime, Index)
})

const InitialListState = <A>(
  Options: VirtualListOptions<A>,
  Items: ReadonlyArray<A>,
  Keys: ReadonlyArray<VirtualKey>
): VirtualListState<A> => {
  const Range = FixedRange(
    Items.length,
    Options.itemSize,
    Options.viewportSize,
    0,
    Options.overscan ?? 2
  )

  const ActiveIndex = Items.length === 0 ? -1 : 0
  const ActiveKey = ActiveIndex < 0 ? undefined : Keys[ActiveIndex]

  return {
    rows: BuildRows(Options.id, Items, Keys, Range, ActiveIndex, Options.itemSize, []),
    range: Range,
    activeIndex: ActiveIndex,
    activeDescendant: ActiveKey === undefined ? undefined : OptionId(Options.id, ActiveKey),
    scrollOffset: 0,
    viewportSize: Options.viewportSize
  }
}

const ListSignals = <A>(State: Signal<VirtualListState<A>>) =>
  Effect.gen(function* () {
    return {
      Rows: yield* Signal.map(State, (Value) => Value.rows),
      Range: yield* Signal.map(State, (Value) => Value.range),
      ActiveIndex: yield* Signal.map(State, (Value) => Value.activeIndex),
      ActiveDescendant: yield* Signal.map(State, (Value) => Value.activeDescendant)
    }
  })

const RegisterListLifetime = () =>
  Effect.gen(function* () {
    const OwnerScope = yield* Effect.scope
    const Lifetime = { disposed: false }

    yield* Scope.addFinalizer(
      OwnerScope,
      Effect.sync(() => (Lifetime.disposed = true))
    )

    return Lifetime
  })

export const make = <A>(
  Options: VirtualListOptions<A>
): Effect.Effect<VirtualList<A>, never, Scope.Scope> => {
  ValidateOptions(Options)
  const Items = Array.from(Options.items)
  const Keys = ValidateVirtualKeys(Items, Options.keyOf, "virtual list")
  const InitialState = InitialListState(Options, Items, Keys)

  return Effect.gen(function* () {
    const State = yield* Signal.make(InitialState)
    const Signals = yield* ListSignals(State)
    const Lifetime = yield* RegisterListLifetime()

    return CreateListController({ Options, Items, Keys, State, Lifetime }, Signals)
  })
}

export const VirtualList = { make }
