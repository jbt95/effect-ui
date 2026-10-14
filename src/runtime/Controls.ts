import { Effect, Stream } from "effect"
import {
  combine,
  Control,
  insert,
  noop,
  removeBetween,
  type Disposer,
  type Host
} from "../Control.js"
import type { ElementChild } from "../Element.js"
import { Signal } from "../Signal.js"
import { ownerDocument } from "./Dom.js"

export interface ShowProps {
  /** A `Signal<boolean>` (reactive) or a plain boolean. */
  when: boolean | Signal<boolean>
  fallback?: ElementChild
  children?: ElementChild
}

interface ShowState {
  readonly Props: ShowProps
  readonly Parent: Node
  readonly Host: Host
  readonly Start: Comment
  readonly End: Comment
  Current: Disposer
  CurrentBranch: boolean | undefined
  Disposed: boolean
  Transition: Promise<void>
}

const renderShowBranch = (State: ShowState, Show: boolean): void => {
  State.Current = State.Host.renderNode(
    Show ? State.Props.children : State.Props.fallback,
    State.Parent,
    State.End
  )
  State.CurrentBranch = Show
}

const transitionShowBranch = async (State: ShowState, Show: boolean): Promise<void> => {
  if (State.Disposed || State.CurrentBranch === Show) return

  const DisposePrevious = State.Current
  State.Current = noop
  const Cleanup = DisposePrevious()
  removeBetween(State.Start, State.End)

  try {
    await Cleanup
  } catch (error) {
    State.Host.reportError(error)
  }

  if (State.Disposed) return

  try {
    renderShowBranch(State, Show)
  } catch (error) {
    State.CurrentBranch = undefined
    removeBetween(State.Start, State.End)
    State.Host.reportError(error)
  }
}

const disposeShowState = async (State: ShowState, Watcher?: Disposer): Promise<void> => {
  State.Disposed = true
  const PendingTransition = State.Transition
  const Cleanup = combine(Watcher === undefined ? [State.Current] : [Watcher, State.Current])()
  State.Current = noop
  removeBetween(State.Start, State.End)
  State.Start.remove()
  State.End.remove()

  if (Watcher === undefined) await Cleanup
  else await combine([() => Cleanup, () => PendingTransition])()
}

const renderInitialShowState = (State: ShowState, Show: boolean): void => {
  try {
    renderShowBranch(State, Show)
  } catch (error) {
    removeBetween(State.Start, State.End)
    State.Start.remove()
    State.End.remove()
    throw error
  }
}

const watchShowState = (State: ShowState, When: Signal<boolean>): Disposer => {
  renderInitialShowState(State, Boolean(When.value))

  const Watcher = State.Host.fork(
    Signal.changes(When).pipe(
      Stream.runForEach((Value) =>
        Effect.promise(() => {
          State.Transition = transitionShowBranch(State, Boolean(Value))

          return State.Transition
        })
      )
    )
  )

  return () => disposeShowState(State, Watcher)
}

const renderStaticShow = (State: ShowState, When: boolean): Disposer => {
  renderInitialShowState(State, Boolean(When))

  return () => disposeShowState(State)
}

const createShowState = (
  Props: ShowProps,
  Parent: Node,
  Host: Host,
  Anchor?: Node | null
): ShowState => {
  const Document = ownerDocument(Parent)
  const Start = Document.createComment("show")
  const End = Document.createComment("/show")
  insert(Parent, Start, Anchor)
  insert(Parent, End, Anchor)

  return {
    Props,
    Parent,
    Host,
    Start,
    End,
    Current: noop,
    CurrentBranch: undefined,
    Disposed: false,
    Transition: Promise.resolve()
  }
}

const showControl = (
  props: ShowProps,
  parent: Node,
  host: Host,
  anchor?: Node | null
): Disposer => {
  const State = createShowState(props, parent, host, anchor)

  const When = props.when

  if (Signal.isSignal(When)) {
    // SAFETY: The public Show contract requires reactive conditions to be boolean signals.
    return watchShowState(State, When as Signal<boolean>)
  }

  return renderStaticShow(State, Boolean(When))
}

export const Show: Control<ShowProps> = Control.make("control/show", showControl)

export interface ForProps<A = any> {
  /** A `Signal<ReadonlyArray<A>>` (reactive) or a plain array. */
  each: ReadonlyArray<A> | Signal<ReadonlyArray<A>>
  /** Stable identity for a row (defaults to the item itself). */
  keyOf?: (item: A) => unknown
  /** Renders a row from its item. */
  children: (item: A) => ElementChild
}

interface ForEntry {
  /** First rendered node, or null when the entry currently renders nothing. */
  first: Node | null
  /** Last rendered node, or null when the entry currently renders nothing. */
  last: Node | null
  item: unknown
  disposer: Disposer
  /** Position in the last committed order, or -1 when not yet committed. */
  order: number
}

interface ForControlState {
  readonly Props: ForProps
  readonly Parent: Node
  readonly Host: Host
  readonly Start: Comment
  readonly End: Comment
  readonly Entries: Map<unknown, ForEntry>
  readonly PendingUpdates: Set<Promise<void>>
  Watcher: Disposer
  Disposed: boolean
}

const moveEntryRange = (parent: Node, first: Node, last: Node, anchor: Node): void => {
  let node: Node | null = first

  while (node !== null) {
    const next: Node | null = node.nextSibling
    parent.insertBefore(node, anchor)

    if (node === last) break
    node = next
  }
}

// Remove nodes added between prev and anchor (both stable, exclusive bounds)
// after a failed render, leaving previously committed content intact.
const removeAddedNodes = (parent: Node, prev: Node | null, anchor: Node): void => {
  let node: Node | null = prev === null ? parent.firstChild : prev.nextSibling

  while (node !== null && node !== anchor) {
    const next: Node | null = node.nextSibling
    node.parentNode?.removeChild(node)
    node = next
  }
}

const removeEntryRange = (first: Node, last: Node): void => {
  let node: Node | null = first

  while (node !== null) {
    const next: Node | null = node.nextSibling
    node.parentNode?.removeChild(node)

    if (node === last) break
    node = next
  }
}

const createForEntry = (State: ForControlState, Item: unknown, Key: unknown): ForEntry => {
  const anchor = State.End
  const prev = anchor.previousSibling
  let disposer: Disposer

  try {
    disposer = State.Host.renderNode(State.Props.children(Item), State.Parent, anchor)
  } catch (error) {
    removeAddedNodes(State.Parent, prev, anchor)
    throw error
  }

  const Created: ForEntry = { first: null, last: null, item: Item, disposer, order: -1 }
  const last = anchor.previousSibling

  if (last !== null && last !== prev) {
    Created.first = prev === null ? State.Parent.firstChild : prev.nextSibling
    Created.last = last
  }

  State.Entries.set(Key, Created)

  return Created
}

const pileIndex = (tails: ReadonlyArray<number>, value: number): number => {
  let low = 0
  let high = tails.length

  while (low < high) {
    const middle = (low + high) >> 1

    if (tails[middle] < value) low = middle + 1
    else high = middle
  }

  return low
}

// Follows parent pointers from the tallest pile top, collecting one longest
// strictly-increasing run.
const followRun = (
  tailPositions: ReadonlyArray<number>,
  previous: ReadonlyArray<number>,
  runLength: number
): ReadonlySet<number> => {
  const keep = new Set<number>()
  let at = runLength === 0 ? -1 : tailPositions[runLength - 1]

  while (at !== -1) {
    keep.add(at)
    at = previous[at]
  }

  return keep
}

// Positions (indices into Desired) of one longest strictly-increasing run of
// committed entry positions. Newly created entries (order -1) never extend a
// run. Entries in the run keep their relative DOM order, so only the rest
// can need moving.
const increasingPositions = (Desired: ReadonlyArray<ForEntry>): ReadonlySet<number> => {
  const tails: Array<number> = []
  const tailPositions: Array<number> = []
  const previous: Array<number> = Array.from({ length: Desired.length }, () => -1)

  for (let index = 0; index < Desired.length; index += 1) {
    const order = Desired[index].order

    if (order < 0) continue

    const pile = pileIndex(tails, order)
    tails[pile] = order
    previous[index] = pile > 0 ? tailPositions[pile - 1] : -1
    tailPositions[pile] = index
  }

  return followRun(tailPositions, previous, tails.length)
}

const placeEntry = (
  State: ForControlState,
  Entry: ForEntry,
  Index: number,
  keep: ReadonlySet<number>,
  Anchor: Node
): Node => {
  const first = Entry.first
  const last = Entry.last

  if (first !== null && last !== null) {
    if (!keep.has(Index) && last.nextSibling !== Anchor) {
      moveEntryRange(State.Parent, first, last, Anchor)
    }

    return first
  }

  return Anchor
}

// True when every entry already sits in committed order: strictly
// increasing positions with no newly created entries. Pure array reads,
// so ordered commits skip the LIS tables and the DOM walk entirely.
const isCommittedOrder = (Desired: ReadonlyArray<ForEntry>): boolean => {
  let previous = -1

  for (const Entry of Desired) {
    if (Entry.order <= previous) return false
    previous = Entry.order
  }

  return true
}

const reorderForEntries = (State: ForControlState, Desired: ReadonlyArray<ForEntry>): void => {
  if (State.Disposed) return

  if (isCommittedOrder(Desired)) return

  const keep = increasingPositions(Desired)
  let Anchor: Node = State.End

  for (let Index = Desired.length - 1; Index >= 0; Index -= 1) {
    const Entry = Desired[Index]
    Anchor = placeEntry(State, Entry, Index, keep, Anchor)
    Entry.order = Index
  }
}

const teardownRemovedEntry = (State: ForControlState, Entry: ForEntry): Promise<void> => {
  const DisposeEntry = Entry.disposer
  Entry.disposer = noop
  const Cleanup = DisposeEntry()
  const first = Entry.first
  const last = Entry.last

  if (first !== null && last !== null) removeEntryRange(first, last)

  Entry.first = null
  Entry.last = null

  return Cleanup
}

const removeForEntries = (
  State: ForControlState,
  Removed: ReadonlyArray<ForEntry>,
  Desired: ReadonlyArray<ForEntry>,
  Index = 0
): Promise<void> => {
  if (State.Disposed) return Promise.resolve()

  if (Index < Removed.length) {
    const Cleanup = teardownRemovedEntry(State, Removed[Index])

    return Cleanup.catch(State.Host.reportError).then(() =>
      removeForEntries(State, Removed, Desired, Index + 1)
    )
  }

  reorderForEntries(State, Desired)

  return Promise.resolve()
}

// Tears down the entry's range and returns a stable insertion anchor for the
// replacement render: the node that followed the old range, or the list end.
const detachEntryRange = (State: ForControlState, Entry: ForEntry): Node => {
  const first = Entry.first
  const last = Entry.last
  const anchor = last !== null ? (last.nextSibling ?? State.End) : State.End

  if (first !== null && last !== null) removeEntryRange(first, last)

  Entry.first = null
  Entry.last = null

  return anchor
}

// Renders replacement content before a stable anchor and adopts the added
// range, cleaning partial renders on failure.
const adoptRenderedRange = (
  State: ForControlState,
  Entry: ForEntry,
  Item: unknown,
  Key: unknown,
  anchor: Node
): void => {
  // Captured after teardown: the node before the insertion point, bounding
  // both range discovery and partial-render cleanup below.
  const prev = anchor.previousSibling

  try {
    Entry.disposer = State.Host.renderNode(State.Props.children(Item), State.Parent, anchor)
    Entry.item = Item
  } catch (error) {
    removeAddedNodes(State.Parent, prev, anchor)
    State.Entries.delete(Key)
    throw error
  }

  const added = anchor.previousSibling

  if (added !== null && added !== prev) {
    Entry.first = prev === null ? State.Parent.firstChild : prev.nextSibling
    Entry.last = added
  }
}

const renderReplacement = (
  State: ForControlState,
  Entry: ForEntry,
  Item: unknown,
  Key: unknown,
  List: ReadonlyArray<unknown>,
  Keys: ReadonlyArray<unknown>,
  Seen: ReadonlySet<unknown>,
  Desired: Array<ForEntry>,
  NextIndex: number,
  anchor: Node
): Promise<void> => {
  if (State.Disposed) return Promise.resolve()

  adoptRenderedRange(State, Entry, Item, Key, anchor)
  Desired.push(Entry)

  return renderForEntries(State, List, Keys, Seen, Desired, NextIndex)
}

const replaceForEntry = (
  State: ForControlState,
  Entry: ForEntry,
  Item: unknown,
  Key: unknown,
  List: ReadonlyArray<unknown>,
  Keys: ReadonlyArray<unknown>,
  Seen: ReadonlySet<unknown>,
  Desired: Array<ForEntry>,
  NextIndex: number
): Promise<void> => {
  const DisposePrevious = Entry.disposer
  Entry.disposer = noop
  const Cleanup = DisposePrevious()
  const anchor = detachEntryRange(State, Entry)

  return Cleanup.catch(State.Host.reportError).then(() =>
    renderReplacement(State, Entry, Item, Key, List, Keys, Seen, Desired, NextIndex, anchor)
  )
}

const renderOneForEntry = (
  State: ForControlState,
  List: ReadonlyArray<unknown>,
  Keys: ReadonlyArray<unknown>,
  Seen: ReadonlySet<unknown>,
  Desired: Array<ForEntry>,
  Index: number
): Promise<void> | undefined => {
  const Item = List[Index]
  const Key = Keys[Index]
  const Existing = State.Entries.get(Key)

  if (Existing === undefined) {
    Desired.push(createForEntry(State, Item, Key))

    return undefined
  }

  if (!Object.is(Existing.item, Item)) {
    return replaceForEntry(State, Existing, Item, Key, List, Keys, Seen, Desired, Index + 1)
  }

  Desired.push(Existing)

  return undefined
}

const collectRemovedEntries = (
  State: ForControlState,
  Seen: ReadonlySet<unknown>
): Array<ForEntry> => {
  const Removed: Array<ForEntry> = []

  for (const [Key, Entry] of State.Entries) {
    if (Seen.has(Key)) continue
    State.Entries.delete(Key)
    Removed.push(Entry)
  }

  return Removed
}

const renderForEntries = (
  State: ForControlState,
  List: ReadonlyArray<unknown>,
  Keys: ReadonlyArray<unknown>,
  Seen: ReadonlySet<unknown>,
  Desired: Array<ForEntry>,
  Index = 0
): Promise<void> => {
  if (State.Disposed) return Promise.resolve()

  for (let NextIndex = Index; NextIndex < List.length; NextIndex += 1) {
    const Pending = renderOneForEntry(State, List, Keys, Seen, Desired, NextIndex)

    if (Pending !== undefined) return Pending
  }

  return removeForEntries(State, collectRemovedEntries(State, Seen), Desired)
}

const syncForEntries = (State: ForControlState, Items: unknown): Promise<void> => {
  if (State.Disposed) return Promise.resolve()

  const List: ReadonlyArray<unknown> = Array.isArray(Items) ? Items : []
  const KeyOf = State.Props.keyOf ?? ((Item: unknown): unknown => Item)
  const Seen = new Set<unknown>()
  const Keys: Array<unknown> = []

  for (const Item of List) {
    const Key = KeyOf(Item)

    if (Seen.has(Key)) throw new Error(`For received duplicate key: ${String(Key)}`)

    Seen.add(Key)
    Keys.push(Key)
  }

  return renderForEntries(State, List, Keys, Seen, [])
}

const disposeForControl = async (State: ForControlState): Promise<void> => {
  State.Disposed = true
  const Updates = Array.from(State.PendingUpdates)

  const EntryDisposers = Array.from(State.Entries.values(), (Entry) => {
    const DisposeEntry = Entry.disposer
    Entry.disposer = noop

    return DisposeEntry
  })

  State.Entries.clear()

  const Cleanup = combine([
    State.Watcher,
    ...EntryDisposers,
    ...Updates.map((Update) => () => Update)
  ])()

  removeBetween(State.Start, State.End)
  State.Start.remove()
  State.End.remove()
  await Cleanup
}

const clearFailedForControl = (State: ForControlState): void => {
  const EntryDisposers = Array.from(State.Entries.values(), (Entry) => Entry.disposer)
  State.Entries.clear()
  void combine(EntryDisposers)().catch(State.Host.reportError)
  removeBetween(State.Start, State.End)
  State.Start.remove()
  State.End.remove()
}

const trackForUpdate = (State: ForControlState, Items: ReadonlyArray<unknown>) =>
  Effect.promise(async () => {
    let Update: Promise<void> | undefined

    try {
      Update = syncForEntries(State, Items)
      State.PendingUpdates.add(Update)
      await Update
    } catch (error) {
      State.Host.reportError(error)
    } finally {
      if (Update !== undefined) State.PendingUpdates.delete(Update)
    }
  })

const startForUpdates = (State: ForControlState, Each: Signal<ReadonlyArray<unknown>>): void => {
  State.Watcher = State.Host.fork(
    Signal.changes(Each).pipe(Stream.runForEach((Items) => trackForUpdate(State, Items)))
  )
}

const initializeForControl = (State: ForControlState): void => {
  try {
    const Each = State.Props.each
    const IsReactive = Signal.isSignal(Each)
    const Initial = syncForEntries(State, IsReactive ? Each.value : Each)
    void Initial.catch(State.Host.reportError)

    if (IsReactive) {
      // SAFETY: IsReactive established the signal shape; `each` is typed as an array signal.
      const EachSignal = Each as Signal<ReadonlyArray<unknown>>
      startForUpdates(State, EachSignal)
    }
  } catch (error) {
    clearFailedForControl(State)
    throw error
  }
}

const forControl = (props: ForProps, parent: Node, host: Host, anchor?: Node | null): Disposer => {
  const doc = ownerDocument(parent)
  const start = doc.createComment("for")
  const end = doc.createComment("/for")
  insert(parent, start, anchor)
  insert(parent, end, anchor)

  const State: ForControlState = {
    Props: props,
    Parent: parent,
    Host: host,
    Start: start,
    End: end,
    Entries: new Map(),
    PendingUpdates: new Set(),
    Watcher: noop,
    Disposed: false
  }

  initializeForControl(State)

  return () => disposeForControl(State)
}

export const For: Control<ForProps> = Control.make("control/for", forControl)

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------
