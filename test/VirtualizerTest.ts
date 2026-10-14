import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { VirtualList, VirtualTable, Virtualizer } from "../src/Virtualizer.js"

const People = Array.from({ length: 1_000 }, (_, index) => ({ id: `person-${index}`, index }))

const Columns = Array.from({ length: 40 }, (_, index) => ({ id: `column-${index}`, index }))

describe("Virtualizer", () => {
  it("calculates fixed-size ranges with bounded overscan", () => {
    expect(Virtualizer.fixedRange(1_000, 20, 100, 200, 1)).toEqual({
      start: 9,
      end: 16,
      offset: 180,
      totalSize: 20_000
    })
    expect(Virtualizer.fixedRange(10, 20, 100, -40, 0)).toEqual({
      start: 0,
      end: 5,
      offset: 0,
      totalSize: 200
    })
    expect(() => Virtualizer.fixedRange(10, 0, 100, 0, 0)).toThrow(/item size/)
  })

  it("windows a keyed list and supports accessible keyboard navigation", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const List = yield* VirtualList.make({
            id: "people-list",
            ariaLabel: "People",
            items: People,
            keyOf: (Person) => Person.id,
            itemSize: 20,
            viewportSize: 100,
            overscan: 1
          })

          expect(List.state.value.rows.map((Row) => Row.index)).toEqual([0, 1, 2, 3, 4, 5])
          expect(List.totalSize).toBe(20_000)
          expect(List.attributes.role).toBe("listbox")
          expect(List.optionAttributes(List.state.value.rows[0])).toEqual({
            id: "people-list-option-string-10-person%2D0",
            role: "option",
            "aria-selected": true,
            "aria-posinset": 1,
            "aria-setsize": 1_000
          })

          yield* List.onScroll(200)

          expect(List.state.value.range).toEqual({
            start: 9,
            end: 16,
            offset: 180,
            totalSize: 20_000
          })
          expect(List.state.value.activeIndex).toBe(10)
          expect(List.state.value.activeDescendant).toBe("people-list-option-string-11-person%2D10")

          let Prevented = false

          const ScrollOffset = yield* List.onKeyDown({
            key: "ArrowDown",
            preventDefault: () => (Prevented = true)
          })

          expect(Prevented).toBe(true)
          expect(ScrollOffset).toBeUndefined()
          expect(List.state.value.activeIndex).toBe(11)

          const ScrollToEnd = yield* List.onKeyDown({
            key: "End",
            preventDefault: () => {}
          })

          expect(ScrollToEnd).toBe(19_900)
          expect(List.state.value.activeIndex).toBe(999)
          expect(List.state.value.range.start).toBe(994)
        })
      )
    )
  })

  it("windows both axes of a grid and navigates active cells", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Table = yield* VirtualTable.make({
            id: "metrics-grid",
            ariaLabel: "Metrics",
            rows: People,
            rowKeyOf: (Person) => Person.id,
            columns: Columns,
            columnKeyOf: (Column) => Column.id,
            rowHeight: 20,
            columnWidth: 50,
            viewportHeight: 100,
            viewportWidth: 150,
            overscan: 1
          })

          expect(Table.state.value.rows).toHaveLength(6)
          expect(Table.state.value.rows[0].cells).toHaveLength(4)
          expect(Table.attributes.role).toBe("grid")
          expect(Table.rowAttributes(Table.state.value.rows[0])).toEqual({
            id: "metrics-grid-row-string-10-person%2D0",
            role: "row",
            "aria-rowindex": 1
          })

          yield* Table.onScroll(200, 500)

          expect(Table.state.value.rowRange.start).toBe(9)
          expect(Table.state.value.columnRange.start).toBe(9)
          expect(Table.state.value.activeRow).toBe(10)
          expect(Table.state.value.activeColumn).toBe(10)

          const ActiveRow = Table.state.value.rows.find((Row) => Row.index === 10)

          expect(ActiveRow).toBeDefined()
          const ActiveCell = ActiveRow?.cells.find((Cell) => Cell.index === 10)

          if (ActiveCell === undefined) throw new Error("Active table cell was not rendered")

          expect(Table.cellAttributes(ActiveCell)).toEqual({
            id: "metrics-grid-cell-string-11-person%2D10-string-11-column%2D10",
            role: "gridcell",
            "aria-colindex": 11,
            "aria-selected": true
          })

          const ScrollPosition = yield* Table.onKeyDown({
            key: "ArrowUp",
            ctrlKey: false,
            metaKey: false,
            preventDefault: () => {}
          })

          expect(ScrollPosition).toEqual({ scrollTop: 180, scrollLeft: 500 })
          expect(Table.state.value.activeRow).toBe(9)

          yield* Table.onKeyDown({
            key: "Home",
            ctrlKey: true,
            metaKey: false,
            preventDefault: () => {}
          })

          expect(Table.state.value.activeRow).toBe(0)
          expect(Table.state.value.activeColumn).toBe(0)
        })
      )
    )
  })

  it("rejects unstable duplicate keys and makes controllers inert after scope disposal", async () => {
    expect(() =>
      VirtualList.make({
        id: "duplicate-list",
        ariaLabel: "Duplicate items",
        items: [{ id: 1 }, { id: 1 }],
        keyOf: (Item) => Item.id,
        itemSize: 20,
        viewportSize: 100
      })
    ).toThrow(/keys must be unique/)

    const Controller = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* Effect.scoped(
          VirtualList.make({
            id: "disposed-list",
            ariaLabel: "Disposed list",
            items: People,
            keyOf: (Person) => Person.id,
            itemSize: 20,
            viewportSize: 100
          })
        )
      })
    )

    await Effect.runPromise(Controller.onScroll(500))
    expect(Controller.state.value.range.start).toBe(0)
    expect(Controller.state.value.activeDescendant).toBe(
      "disposed-list-option-string-10-person%2D0"
    )
  })
})
