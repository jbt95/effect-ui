import { Effect, Scope } from "effect"
import { Signal } from "./Signal.js"
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

export interface VirtualTableOptions<Row, Column> {
  /** Stable DOM id used for the grid and its active cell. */
  readonly id: string
  /** Accessible name for the composite grid. */
  readonly ariaLabel: string
  readonly rows: ReadonlyArray<Row>
  readonly rowKeyOf: (row: Row) => VirtualKey
  readonly columns: ReadonlyArray<Column>
  readonly columnKeyOf: (column: Column) => VirtualKey
  readonly rowHeight: number
  readonly columnWidth: number
  readonly viewportHeight: number
  readonly viewportWidth: number
  readonly overscan?: number
}

export interface VirtualTableCell<Column> {
  readonly key: VirtualKey
  readonly id: string
  readonly column: Column
  readonly index: number
  readonly start: number
  readonly active: boolean
}

export interface VirtualTableRow<Row, Column> {
  readonly key: VirtualKey
  readonly id: string
  readonly item: Row
  readonly index: number
  readonly start: number
  readonly cells: ReadonlyArray<VirtualTableCell<Column>>
}

export interface VirtualTableState<Row, Column> {
  readonly rows: ReadonlyArray<VirtualTableRow<Row, Column>>
  readonly rowRange: VirtualRange
  readonly columnRange: VirtualRange
  readonly activeRow: number
  readonly activeColumn: number
  readonly activeDescendant: string | undefined
  readonly scrollTop: number
  readonly scrollLeft: number
  readonly viewportHeight: number
  readonly viewportWidth: number
}

export interface VirtualTableKeyboardEvent {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly preventDefault: () => void
}

export interface VirtualTable<Row, Column> {
  readonly id: string
  readonly role: "grid"
  readonly tabIndex: 0
  readonly ariaLabel: string
  readonly rowCount: number
  readonly columnCount: number
  readonly totalHeight: number
  readonly totalWidth: number
  readonly state: Signal<VirtualTableState<Row, Column>>
  readonly rows: Signal<ReadonlyArray<VirtualTableRow<Row, Column>>>
  readonly rowRange: Signal<VirtualRange>
  readonly columnRange: Signal<VirtualRange>
  readonly activeDescendant: Signal<string | undefined>
  readonly attributes: {
    readonly id: string
    readonly role: "grid"
    readonly tabIndex: 0
    readonly "aria-label": string
    readonly "aria-rowcount": number
    readonly "aria-colcount": number
    readonly "aria-activedescendant": Signal<string | undefined>
  }
  readonly rowAttributes: (row: VirtualTableRow<Row, Column>) => {
    readonly id: string
    readonly role: "row"
    readonly "aria-rowindex": number
  }
  readonly cellAttributes: (cell: VirtualTableCell<Column>) => {
    readonly id: string
    readonly role: "gridcell"
    readonly "aria-colindex": number
    readonly "aria-selected": boolean
  }
  /** Recompute visible row and column windows after a scroll. */
  readonly onScroll: (scrollTop: number, scrollLeft: number) => Effect.Effect<void>
  /** Update both viewport dimensions after resize. */
  readonly resize: (height: number, width: number) => Effect.Effect<void>
  /** Handle two-dimensional arrow, Home/End, and page-navigation keys. */
  readonly onKeyDown: (
    event: VirtualTableKeyboardEvent
  ) => Effect.Effect<{ readonly scrollTop: number; readonly scrollLeft: number } | undefined>
  /** Set the active cell and return any updated scroll offsets. */
  readonly setActiveCell: (
    rowIndex: number,
    columnIndex: number
  ) => Effect.Effect<{ readonly scrollTop: number; readonly scrollLeft: number } | undefined>
}

const RowId = (Id: string, Key: VirtualKey): string => `${Id}-row-${KeyToken(Key)}`

const CellId = (Id: string, RowKey: VirtualKey, ColumnKey: VirtualKey): string =>
  `${Id}-cell-${KeyToken(RowKey)}-${KeyToken(ColumnKey)}`

const VisibleIndex = (Index: number, Range: VirtualRange, Count: number): number => {
  if (Count === 0) return -1

  return Math.max(Range.start, Math.min(Index, Math.max(Range.start, Range.end - 1)))
}

interface TableData<Row, Column> {
  readonly Options: VirtualTableOptions<Row, Column>
  readonly Rows: ReadonlyArray<Row>
  readonly RowKeys: ReadonlyArray<VirtualKey>
  readonly Columns: ReadonlyArray<Column>
  readonly ColumnKeys: ReadonlyArray<VirtualKey>
}

interface TableWindow {
  readonly scrollTop: number
  readonly scrollLeft: number
  readonly viewportHeight: number
  readonly viewportWidth: number
  readonly activeRow: number
  readonly activeColumn: number
}

const BuildCells = <Row, Column>(
  Data: TableData<Row, Column>,
  ColumnRange: VirtualRange,
  ActiveRow: number,
  ActiveColumn: number,
  RowIndex: number
): ReadonlyArray<VirtualTableCell<Column>> => {
  const Cells: Array<VirtualTableCell<Column>> = []

  for (let Index = ColumnRange.start; Index < ColumnRange.end; Index += 1) {
    const Key = Data.ColumnKeys[Index]

    Cells.push({
      key: Key,
      id: CellId(Data.Options.id, Data.RowKeys[RowIndex], Key),
      column: Data.Columns[Index],
      index: Index,
      start: Index * Data.Options.columnWidth,
      active: RowIndex === ActiveRow && Index === ActiveColumn
    })
  }

  return Cells
}

const BuildRows = <Row, Column>(
  Data: TableData<Row, Column>,
  RowRange: VirtualRange,
  ColumnRange: VirtualRange,
  ActiveRow: number,
  ActiveColumn: number
): ReadonlyArray<VirtualTableRow<Row, Column>> => {
  const VisibleRows: Array<VirtualTableRow<Row, Column>> = []

  for (let Index = RowRange.start; Index < RowRange.end; Index += 1) {
    const Key = Data.RowKeys[Index]

    VisibleRows.push({
      key: Key,
      id: RowId(Data.Options.id, Key),
      item: Data.Rows[Index],
      index: Index,
      start: Index * Data.Options.rowHeight,
      cells: BuildCells(Data, ColumnRange, ActiveRow, ActiveColumn, Index)
    })
  }

  return VisibleRows
}

const VisibleCell = <Row, Column>(
  Data: TableData<Row, Column>,
  Window: TableWindow
): ActiveCell => {
  const RowWindow = FixedRange(
    Data.Rows.length,
    Data.Options.rowHeight,
    Window.viewportHeight,
    Window.scrollTop,
    0
  )

  const ColumnWindow = FixedRange(
    Data.Columns.length,
    Data.Options.columnWidth,
    Window.viewportWidth,
    Window.scrollLeft,
    0
  )

  return {
    row: VisibleIndex(Window.activeRow, RowWindow, Data.Rows.length),
    column: VisibleIndex(Window.activeColumn, ColumnWindow, Data.Columns.length)
  }
}

const ActiveCellId = <Row, Column>(
  Data: TableData<Row, Column>,
  Active: ActiveCell
): string | undefined => {
  if (Active.row < 0 || Active.column < 0) return undefined

  return CellId(Data.Options.id, Data.RowKeys[Active.row], Data.ColumnKeys[Active.column])
}

interface TableGeometry {
  readonly rowRange: VirtualRange
  readonly columnRange: VirtualRange
  readonly active: ActiveCell
}

const CalculateTableGeometry = <Row, Column>(
  Data: TableData<Row, Column>,
  Input: TableWindow
): TableGeometry => ({
  rowRange: FixedRange(
    Data.Rows.length,
    Data.Options.rowHeight,
    Input.viewportHeight,
    Input.scrollTop,
    Data.Options.overscan ?? 2
  ),
  columnRange: FixedRange(
    Data.Columns.length,
    Data.Options.columnWidth,
    Input.viewportWidth,
    Input.scrollLeft,
    Data.Options.overscan ?? 2
  ),
  active: VisibleCell(Data, Input)
})

const TableOffsets = <Row, Column>(
  Data: TableData<Row, Column>,
  Input: TableWindow
): Pick<VirtualTableState<Row, Column>, "scrollTop" | "scrollLeft"> => ({
  scrollTop: NormalizeScrollOffset(
    Input.scrollTop,
    Data.Rows.length * Data.Options.rowHeight,
    Input.viewportHeight
  ),
  scrollLeft: NormalizeScrollOffset(
    Input.scrollLeft,
    Data.Columns.length * Data.Options.columnWidth,
    Input.viewportWidth
  )
})

const BuildState = <Row, Column>(
  Data: TableData<Row, Column>,
  Input: TableWindow
): VirtualTableState<Row, Column> => {
  const Geometry = CalculateTableGeometry(Data, Input)

  return {
    rows: BuildRows(
      Data,
      Geometry.rowRange,
      Geometry.columnRange,
      Geometry.active.row,
      Geometry.active.column
    ),
    rowRange: Geometry.rowRange,
    columnRange: Geometry.columnRange,
    activeRow: Geometry.active.row,
    activeColumn: Geometry.active.column,
    activeDescendant: ActiveCellId(Data, Geometry.active),
    ...TableOffsets(Data, Input),
    viewportHeight: Input.viewportHeight,
    viewportWidth: Input.viewportWidth
  }
}

const EnsureVisible = (
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

interface TableRuntime<Row, Column> extends TableData<Row, Column> {
  readonly State: Signal<VirtualTableState<Row, Column>>
  readonly Lifetime: { disposed: boolean }
}

interface TableSignals<Row, Column> {
  readonly Rows: Signal<ReadonlyArray<VirtualTableRow<Row, Column>>>
  readonly RowRange: Signal<VirtualRange>
  readonly ColumnRange: Signal<VirtualRange>
  readonly ActiveDescendant: Signal<string | undefined>
}

const TableAttributes = <Row, Column>(
  Runtime: TableRuntime<Row, Column>,
  ActiveDescendant: Signal<string | undefined>
): VirtualTable<Row, Column>["attributes"] => ({
  id: Runtime.Options.id,
  role: "grid",
  tabIndex: 0,
  "aria-label": Runtime.Options.ariaLabel,
  "aria-rowcount": Runtime.Rows.length,
  "aria-colcount": Runtime.Columns.length,
  "aria-activedescendant": ActiveDescendant
})

const TableSignals = <Row, Column>(State: Signal<VirtualTableState<Row, Column>>) =>
  Effect.gen(function* () {
    return {
      Rows: yield* Signal.map(State, (Value) => Value.rows),
      RowRange: yield* Signal.map(State, (Value) => Value.rowRange),
      ColumnRange: yield* Signal.map(State, (Value) => Value.columnRange),
      ActiveDescendant: yield* Signal.map(State, (Value) => Value.activeDescendant)
    }
  })

const RegisterTableLifetime = () =>
  Effect.gen(function* () {
    const OwnerScope = yield* Effect.scope
    const Lifetime = { disposed: false }

    yield* Scope.addFinalizer(
      OwnerScope,
      Effect.sync(() => (Lifetime.disposed = true))
    )

    return Lifetime
  })

type ScrollPosition = { readonly scrollTop: number; readonly scrollLeft: number }

interface ActiveCell {
  readonly row: number
  readonly column: number
}

const UpdateTableState = <Row, Column>(
  Runtime: TableRuntime<Row, Column>,
  Window: TableWindow
): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (Runtime.Lifetime.disposed) return Effect.void

    ValidatePositiveSize(Window.viewportHeight, "virtual table viewportHeight")
    ValidatePositiveSize(Window.viewportWidth, "virtual table viewportWidth")

    return Runtime.State.set(BuildState(Runtime, Window))
  })

const NormalizeCellIndex = (Index: number, Count: number): number => {
  if (!Number.isFinite(Index))
    throw new RangeError("[@effect/ui] virtual table cell indexes must be finite")

  return Math.max(0, Math.min(Count - 1, Math.trunc(Index)))
}

const ActiveCellScroll = <Row, Column>(
  Runtime: TableRuntime<Row, Column>,
  Current: VirtualTableState<Row, Column>,
  Active: ActiveCell
): ScrollPosition => ({
  scrollTop: EnsureVisible(
    Active.row,
    Runtime.Options.rowHeight,
    Current.viewportHeight,
    Current.scrollTop
  ),
  scrollLeft: EnsureVisible(
    Active.column,
    Runtime.Options.columnWidth,
    Current.viewportWidth,
    Current.scrollLeft
  )
})

const SetActiveCell = <Row, Column>(
  Runtime: TableRuntime<Row, Column>,
  Current: VirtualTableState<Row, Column>,
  Active: ActiveCell
): Effect.Effect<ScrollPosition | undefined> => {
  const Position = ActiveCellScroll(Runtime, Current, Active)

  return UpdateTableState(Runtime, {
    ...Current,
    ...Position,
    activeRow: Active.row,
    activeColumn: Active.column
  }).pipe(
    Effect.as(
      Position.scrollTop === Current.scrollTop && Position.scrollLeft === Current.scrollLeft
        ? undefined
        : Position
    )
  )
}

const MoveActiveCell = <Row, Column>(
  Runtime: TableRuntime<Row, Column>,
  RowIndex: number,
  ColumnIndex: number
): Effect.Effect<ScrollPosition | undefined> =>
  Effect.suspend(() => {
    if (Runtime.Lifetime.disposed || Runtime.Rows.length === 0 || Runtime.Columns.length === 0) {
      return Effect.succeed(undefined)
    }

    const Current = Runtime.State.value

    const Active = {
      row: NormalizeCellIndex(RowIndex, Runtime.Rows.length),
      column: NormalizeCellIndex(ColumnIndex, Runtime.Columns.length)
    }

    return SetActiveCell(Runtime, Current, Active)
  })

const OnTableScroll = <Row, Column>(
  Runtime: TableRuntime<Row, Column>,
  ScrollTop: number,
  ScrollLeft: number
): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (Runtime.Lifetime.disposed) return Effect.void

    const Current = Runtime.State.value

    return UpdateTableState(Runtime, { ...Current, scrollTop: ScrollTop, scrollLeft: ScrollLeft })
  })

const ResizeTable = <Row, Column>(
  Runtime: TableRuntime<Row, Column>,
  Height: number,
  Width: number
): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (Runtime.Lifetime.disposed) return Effect.void

    const Current = Runtime.State.value

    return UpdateTableState(Runtime, {
      ...Current,
      viewportHeight: Height,
      viewportWidth: Width
    })
  })

interface GridKeyContext<Row, Column> {
  readonly EventValue: VirtualTableKeyboardEvent
  readonly Current: VirtualTableState<Row, Column>
  readonly LastRow: number
  readonly LastColumn: number
  readonly PageRows: number
}

type GridKeyHandler = <Row, Column>(Context: GridKeyContext<Row, Column>) => ActiveCell

const GridKeyHandlers = new Map<string, GridKeyHandler>([
  [
    "ArrowUp",
    ({ Current }) => ({
      row: Math.max(0, Current.activeRow - 1),
      column: Current.activeColumn
    })
  ],
  [
    "ArrowDown",
    ({ Current, LastRow }) => ({
      row: Math.min(LastRow, Current.activeRow + 1),
      column: Current.activeColumn
    })
  ],
  [
    "ArrowLeft",
    ({ Current }) => ({
      row: Current.activeRow,
      column: Math.max(0, Current.activeColumn - 1)
    })
  ],
  [
    "ArrowRight",
    ({ Current, LastColumn }) => ({
      row: Current.activeRow,
      column: Math.min(LastColumn, Current.activeColumn + 1)
    })
  ],
  [
    "PageUp",
    ({ Current, PageRows }) => ({
      row: Math.max(0, Current.activeRow - PageRows),
      column: Current.activeColumn
    })
  ],
  [
    "PageDown",
    ({ Current, LastRow, PageRows }) => ({
      row: Math.min(LastRow, Current.activeRow + PageRows),
      column: Current.activeColumn
    })
  ],
  [
    "Home",
    ({ EventValue, Current }) => ({
      row: EventValue.ctrlKey || EventValue.metaKey ? 0 : Current.activeRow,
      column: 0
    })
  ],
  [
    "End",
    ({ EventValue, Current, LastRow, LastColumn }) => ({
      row: EventValue.ctrlKey || EventValue.metaKey ? LastRow : Current.activeRow,
      column: LastColumn
    })
  ]
])

const GridTargetForKey = <Row, Column>(
  Context: GridKeyContext<Row, Column>
): ActiveCell | undefined => GridKeyHandlers.get(Context.EventValue.key)?.(Context)

const OnTableKeyDown = <Row, Column>(
  Runtime: TableRuntime<Row, Column>,
  EventValue: VirtualTableKeyboardEvent
): Effect.Effect<ScrollPosition | undefined> =>
  Effect.suspend(() => {
    if (Runtime.Lifetime.disposed || Runtime.Rows.length === 0 || Runtime.Columns.length === 0) {
      return Effect.succeed(undefined)
    }

    const Current = Runtime.State.value
    const PageRows = Math.max(1, Math.floor(Current.viewportHeight / Runtime.Options.rowHeight))

    const Target = GridTargetForKey({
      EventValue,
      Current,
      LastRow: Runtime.Rows.length - 1,
      LastColumn: Runtime.Columns.length - 1,
      PageRows
    })

    if (Target === undefined) return Effect.succeed(undefined)

    EventValue.preventDefault()

    return MoveActiveCell(Runtime, Target.row, Target.column)
  })

const TableActions = <Row, Column>(
  Runtime: TableRuntime<Row, Column>
): Pick<
  VirtualTable<Row, Column>,
  "rowAttributes" | "cellAttributes" | "onScroll" | "resize" | "onKeyDown" | "setActiveCell"
> => ({
  rowAttributes: (RowValue: VirtualTableRow<Row, Column>) => ({
    id: RowValue.id,
    role: "row",
    "aria-rowindex": RowValue.index + 1
  }),
  cellAttributes: (Cell: VirtualTableCell<Column>) => ({
    id: Cell.id,
    role: "gridcell",
    "aria-colindex": Cell.index + 1,
    "aria-selected": Cell.active
  }),
  onScroll: (ScrollTop: number, ScrollLeft: number) =>
    OnTableScroll(Runtime, ScrollTop, ScrollLeft),
  resize: (Height: number, Width: number) => ResizeTable(Runtime, Height, Width),
  onKeyDown: (EventValue: VirtualTableKeyboardEvent) => OnTableKeyDown(Runtime, EventValue),
  setActiveCell: (RowIndex: number, ColumnIndex: number) =>
    MoveActiveCell(Runtime, RowIndex, ColumnIndex)
})

const CreateTableController = <Row, Column>(
  Runtime: TableRuntime<Row, Column>,
  Signals: TableSignals<Row, Column>
): VirtualTable<Row, Column> => ({
  id: Runtime.Options.id,
  role: "grid",
  tabIndex: 0,
  ariaLabel: Runtime.Options.ariaLabel,
  rowCount: Runtime.Rows.length,
  columnCount: Runtime.Columns.length,
  totalHeight: Runtime.Rows.length * Runtime.Options.rowHeight,
  totalWidth: Runtime.Columns.length * Runtime.Options.columnWidth,
  state: Runtime.State,
  rows: Signals.Rows,
  rowRange: Signals.RowRange,
  columnRange: Signals.ColumnRange,
  activeDescendant: Signals.ActiveDescendant,
  attributes: TableAttributes(Runtime, Signals.ActiveDescendant),
  ...TableActions(Runtime)
})

const ValidateOptions = <Row, Column>(Options: VirtualTableOptions<Row, Column>): void => {
  ValidateIdentity(Options.id, "virtual table id")

  if (Options.ariaLabel.trim().length === 0) {
    throw new TypeError("[@effect/ui] virtual table ariaLabel must not be empty")
  }

  ValidatePositiveSize(Options.rowHeight, "virtual table rowHeight")
  ValidatePositiveSize(Options.columnWidth, "virtual table columnWidth")
  ValidatePositiveSize(Options.viewportHeight, "virtual table viewportHeight")
  ValidatePositiveSize(Options.viewportWidth, "virtual table viewportWidth")
  ValidateOverscan(Options.overscan ?? 2)
}

const CreateTableData = <Row, Column>(
  Options: VirtualTableOptions<Row, Column>
): TableData<Row, Column> => {
  ValidateOptions(Options)

  const Rows = Array.from(Options.rows)
  const Columns = Array.from(Options.columns)
  const RowKeys = ValidateVirtualKeys(Rows, Options.rowKeyOf, "virtual table row")
  const ColumnKeys = ValidateVirtualKeys(Columns, Options.columnKeyOf, "virtual table column")

  return { Options, Rows, RowKeys, Columns, ColumnKeys }
}

const InitialTableWindow = <Row, Column>(Data: TableData<Row, Column>): TableWindow => {
  const ActiveIndex = Data.Rows.length === 0 || Data.Columns.length === 0 ? -1 : 0

  return {
    scrollTop: 0,
    scrollLeft: 0,
    viewportHeight: Data.Options.viewportHeight,
    viewportWidth: Data.Options.viewportWidth,
    activeRow: ActiveIndex,
    activeColumn: ActiveIndex
  }
}

const make = <Row, Column>(
  Options: VirtualTableOptions<Row, Column>
): Effect.Effect<VirtualTable<Row, Column>, never, Scope.Scope> => {
  const Data = CreateTableData(Options)
  const InitialState = BuildState(Data, InitialTableWindow(Data))

  return Effect.gen(function* () {
    const State = yield* Signal.make(InitialState)
    const Signals = yield* TableSignals(State)
    const Lifetime = yield* RegisterTableLifetime()

    return CreateTableController({ ...Data, State, Lifetime }, Signals)
  })
}

export const VirtualTable = { make }
