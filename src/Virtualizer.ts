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

/** Pure fixed-size geometry shared by the list and table controllers. */
export const Virtualizer = {
  fixedRange: FixedRange
}
