import { Component, For, Lifecycle, Ref, VirtualList, VirtualTable } from "@effect/ui"
import { Effect } from "effect"

interface Person {
  readonly id: string
  readonly name: string
  readonly team: string
}

interface MetricColumn {
  readonly id: string
  readonly label: string
}

const People: ReadonlyArray<Person> = Array.from({ length: 2_000 }, (_, index) => ({
  id: `member-${index + 1}`,
  name: `Member ${index + 1}`,
  team: `Team ${(index % 12) + 1}`
}))

const MetricColumns: ReadonlyArray<MetricColumn> = Array.from({ length: 32 }, (_, index) => ({
  id: `metric-${index + 1}`,
  label: `Metric ${index + 1}`
}))

const ListViewportStyle = {
  height: "220px",
  overflowY: "auto",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  position: "relative"
} as const

const TableViewportStyle = {
  height: "220px",
  width: "100%",
  maxWidth: "720px",
  overflow: "auto",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  position: "relative"
} as const

const ObserveListResize = (
  List: VirtualList.VirtualList<Person>,
  Viewport: Ref.RefObject<HTMLDivElement>
) =>
  Effect.gen(function* () {
    let Observer: ResizeObserver | undefined

    yield* Lifecycle.onCleanup(Effect.sync(() => Observer?.disconnect()))
    yield* Lifecycle.onMount(
      Effect.sync(() => {
        const Element = Viewport.current

        if (Element === null) return

        Observer = new ResizeObserver((Entries) => {
          const Bounds = Entries[0]?.contentRect

          if (Bounds !== undefined) void Effect.runPromise(List.resize(Bounds.height))
        })

        Observer.observe(Element)
      })
    )
  })

const ObserveTableResize = (
  Table: VirtualTable.VirtualTable<Person, MetricColumn>,
  Viewport: Ref.RefObject<HTMLDivElement>
) =>
  Effect.gen(function* () {
    let Observer: ResizeObserver | undefined

    yield* Lifecycle.onCleanup(Effect.sync(() => Observer?.disconnect()))
    yield* Lifecycle.onMount(
      Effect.sync(() => {
        const Element = Viewport.current

        if (Element === null) return

        Observer = new ResizeObserver((Entries) => {
          const Bounds = Entries[0]?.contentRect

          if (Bounds !== undefined) {
            void Effect.runPromise(Table.resize(Bounds.height, Bounds.width))
          }
        })

        Observer.observe(Element)
      })
    )
  })

const HandleListKeyDown = (
  List: VirtualList.VirtualList<Person>,
  Viewport: Ref.RefObject<HTMLDivElement>,
  EventValue: KeyboardEvent
) =>
  List.onKeyDown({
    key: EventValue.key,
    preventDefault: () => EventValue.preventDefault()
  }).pipe(
    Effect.tap((ScrollOffset) => {
      const Element = Viewport.current

      if (ScrollOffset === undefined || Element === null) return Effect.void

      return Effect.sync(() => (Element.scrollTop = ScrollOffset))
    })
  )

const HandleTableKeyDown = (
  Table: VirtualTable.VirtualTable<Person, MetricColumn>,
  Viewport: Ref.RefObject<HTMLDivElement>,
  EventValue: KeyboardEvent
) =>
  Table.onKeyDown({
    key: EventValue.key,
    ctrlKey: EventValue.ctrlKey,
    metaKey: EventValue.metaKey,
    preventDefault: () => EventValue.preventDefault()
  }).pipe(
    Effect.tap((Position) => {
      const Element = Viewport.current

      if (Position === undefined || Element === null) return Effect.void

      return Effect.sync(() => {
        Element.scrollTop = Position.scrollTop
        Element.scrollLeft = Position.scrollLeft
      })
    })
  )

const RenderPersonRow = (
  List: VirtualList.VirtualList<Person>,
  Row: VirtualList.VirtualListRow<Person>
) => (
  <div
    {...List.optionAttributes(Row)}
    onClick={List.setActive(Row.index)}
    style={{
      position: "absolute",
      insetInline: 0,
      top: `${Row.start}px`,
      height: "44px",
      boxSizing: "border-box",
      padding: "10px 14px",
      borderBottom: "1px solid #e2e8f0",
      background: Row.active ? "#eff6ff" : "white"
    }}
  >
    <strong>{Row.item.name}</strong> <span>— {Row.item.team}</span>
  </div>
)

const RenderPeopleList = (
  List: VirtualList.VirtualList<Person>,
  Viewport: Ref.RefObject<HTMLDivElement>
) => (
  <section aria-labelledby="people-list-title">
    <h3 id="people-list-title">Virtualized people list</h3>
    <div
      {...List.attributes}
      ref={Viewport}
      style={ListViewportStyle}
      onScroll={(EventValue) =>
        List.onScroll(EventValue.currentTarget.scrollTop, EventValue.currentTarget.clientHeight)
      }
      onKeyDown={(EventValue) => HandleListKeyDown(List, Viewport, EventValue)}
    >
      <div style={{ height: `${List.totalSize}px`, position: "relative" }}>
        <For.View each={List.rows} keyOf={(Row) => Row.key}>
          {(Row) => RenderPersonRow(List, Row)}
        </For.View>
      </div>
    </div>
  </section>
)

const RenderMetricCell = (
  Table: VirtualTable.VirtualTable<Person, MetricColumn>,
  Cell: VirtualTable.VirtualTableCell<MetricColumn>,
  PersonValue: Person
) => (
  <div
    {...Table.cellAttributes(Cell)}
    style={{
      position: "absolute",
      left: `${Cell.start}px`,
      width: "140px",
      height: "40px",
      boxSizing: "border-box",
      overflow: "hidden",
      padding: "10px",
      borderBottom: "1px solid #e2e8f0",
      borderRight: "1px solid #e2e8f0",
      background: Cell.active ? "#eff6ff" : "white"
    }}
  >
    {PersonValue.name}: {Cell.column.label}
  </div>
)

const RenderMetricRow = (
  Table: VirtualTable.VirtualTable<Person, MetricColumn>,
  Row: VirtualTable.VirtualTableRow<Person, MetricColumn>
) => (
  <div
    {...Table.rowAttributes(Row)}
    style={{ position: "absolute", top: `${Row.start}px`, height: "40px" }}
  >
    <For.View each={Row.cells} keyOf={(Cell) => Cell.key}>
      {(Cell) => RenderMetricCell(Table, Cell, Row.item)}
    </For.View>
  </div>
)

const RenderMetricsGrid = (
  Table: VirtualTable.VirtualTable<Person, MetricColumn>,
  Viewport: Ref.RefObject<HTMLDivElement>
) => (
  <section aria-labelledby="metrics-grid-title">
    <h3 id="metrics-grid-title">Two-axis virtualized grid</h3>
    <div
      {...Table.attributes}
      ref={Viewport}
      style={TableViewportStyle}
      onScroll={(EventValue) =>
        Table.onScroll(EventValue.currentTarget.scrollTop, EventValue.currentTarget.scrollLeft)
      }
      onKeyDown={(EventValue) => HandleTableKeyDown(Table, Viewport, EventValue)}
    >
      <div
        style={{
          height: `${Table.totalHeight}px`,
          width: `${Table.totalWidth}px`,
          position: "relative"
        }}
      >
        <For.View each={Table.rows} keyOf={(Row) => Row.key}>
          {(Row) => RenderMetricRow(Table, Row)}
        </For.View>
      </div>
    </div>
  </section>
)

const PeopleListView = Component.local(() =>
  Effect.gen(function* () {
    const List = yield* VirtualList.make({
      id: "example-people-list",
      ariaLabel: "People directory",
      items: People,
      keyOf: (Person) => Person.id,
      itemSize: 44,
      viewportSize: 220,
      overscan: 3
    })

    const Viewport = Ref.make<HTMLDivElement>()

    yield* ObserveListResize(List, Viewport)

    return RenderPeopleList(List, Viewport)
  })
)

const MetricsGridView = Component.local(() =>
  Effect.gen(function* () {
    const Table = yield* VirtualTable.make({
      id: "example-metrics-table",
      ariaLabel: "Team metrics",
      rows: People,
      rowKeyOf: (Person) => Person.id,
      columns: MetricColumns,
      columnKeyOf: (Column) => Column.id,
      rowHeight: 40,
      columnWidth: 140,
      viewportHeight: 220,
      viewportWidth: 720,
      overscan: 2
    })

    const Viewport = Ref.make<HTMLDivElement>()

    yield* ObserveTableResize(Table, Viewport)

    return RenderMetricsGrid(Table, Viewport)
  })
)

export const VirtualizedView = Component.sync(() => (
  <section aria-labelledby="virtualization-title">
    <h2 id="virtualization-title">Large collections</h2>
    <p>
      Only the visible window plus overscan is rendered. Focus the list or grid and use the arrow
      keys, Home/End, and page navigation.
    </p>
    <PeopleListView />
    <MetricsGridView />
  </section>
))
