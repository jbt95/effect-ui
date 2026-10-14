import { FixedRange } from "./virtualization/Window.js"

export type { VirtualRange, VirtualKey } from "./virtualization/Window.js"

export { VirtualList } from "./VirtualList.js"

export type {
  VirtualList as VirtualListController,
  VirtualListOptions,
  VirtualListRow,
  VirtualListState,
  VirtualListKeyboardEvent
} from "./VirtualList.js"

export { VirtualTable } from "./VirtualTable.js"

export type {
  VirtualTable as VirtualTableController,
  VirtualTableOptions,
  VirtualTableCell,
  VirtualTableRow,
  VirtualTableState,
  VirtualTableKeyboardEvent
} from "./VirtualTable.js"

/**
 * Pure fixed-size windowing geometry shared by the list and table
 * controllers. See `fixedRange`.
 */
export const Virtualizer = {
  fixedRange: FixedRange
}

/**
 * Computes which fixed-size window to render: `start`/`end` indices clamped
 * to the collection, the pixel `offset` of `start`, and `totalSize`.
 * Negative or overflowing scroll offsets are clamped; invalid sizes throw.
 */
export const fixedRange = FixedRange
