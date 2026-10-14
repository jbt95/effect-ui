export interface Row {
  readonly id: number
  readonly label: string
  readonly value: string
}

export type KeyedOperation = "create" | "append" | "update" | "swap" | "delete" | "clear"

export const KeyedOperations: ReadonlyArray<KeyedOperation> = [
  "create",
  "append",
  "update",
  "swap",
  "delete",
  "clear"
]

export const rowCount = (): number => {
  if (typeof window === "undefined") return 1_000

  const Requested = Number(new URLSearchParams(window.location.search).get("rows") ?? 1_000)

  if (!Number.isInteger(Requested) || Requested < 2 || Requested > 100_000) {
    throw new Error("rows must be an integer between 2 and 100000")
  }

  return Requested
}

export const updateEvery = (): number => {
  if (typeof window === "undefined") return 10

  const Requested = Number(new URLSearchParams(window.location.search).get("updateEvery") ?? 10)

  if (!Number.isInteger(Requested) || Requested < 1 || Requested > 100_000) {
    throw new Error("updateEvery must be an integer between 1 and 100000")
  }

  return Requested
}

export const makeRows = (count: number, firstId = 1): ReadonlyArray<Row> =>
  Array.from({ length: count }, (_, index) => {
    const id = firstId + index

    return { id, label: `Row ${id}`, value: `Value ${id}` }
  })

export const baselineFor = (operation: KeyedOperation, total: number): ReadonlyArray<Row> =>
  operation === "create" ? [] : makeRows(total)

export const applyKeyedOperation = (
  operation: KeyedOperation,
  rows: ReadonlyArray<Row>,
  total: number,
  every: number
): ReadonlyArray<Row> => {
  switch (operation) {
    case "create":
      return makeRows(total)
    case "append":
      return [...rows, ...makeRows(total, total + 1)]
    case "update":
      return rows.map((row, index) =>
        index % every === 0
          ? { ...row, label: `${row.label} updated`, value: `${row.value} updated` }
          : row
      )
    case "swap": {
      if (rows.length < 2) return rows

      const next = rows.slice()
      const first = next[0]
      const lastIndex = next.length - 1
      next[0] = next[lastIndex]
      next[lastIndex] = first

      return next
    }
    case "delete":
      return rows.filter((row) => row.id !== Math.floor(total / 2) + 1)
    case "clear":
      return []
  }
}

const hashText = (text: string): number => {
  let hash = 2_166_136_261

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }

  return hash >>> 0
}

export const rowsChecksum = (rows: ReadonlyArray<Row>): number => {
  let hash = 2_166_136_261

  for (const row of rows) {
    hash = hashText(`${hash}:${row.id}:${row.label}:${row.value}`)
  }

  return hash >>> 0
}

export const domChecksum = (root: HTMLElement): number => {
  let hash = 2_166_136_261

  for (const element of root.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]")) {
    hash = hashText(
      `${hash}:${element.cells[0]?.textContent}:${element.cells[1]?.textContent}:${element.cells[2]?.textContent}`
    )
  }

  return hash >>> 0
}

export const matchesRows = (root: HTMLElement, rows: ReadonlyArray<Row>): boolean => {
  const elements = root.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]")
  if (elements.length !== rows.length) return false

  for (let index = 0; index < rows.length; index += 1) {
    const element = elements[index]
    const row = rows[index]

    if (
      element.dataset.rowId !== String(row.id) ||
      element.cells.length !== 3 ||
      element.cells[0].textContent !== String(row.id) ||
      element.cells[1].textContent !== row.label ||
      element.cells[2].textContent !== row.value
    ) {
      return false
    }
  }

  return true
}
