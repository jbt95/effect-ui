export interface Summary {
  readonly samples: number
  readonly median: number
  readonly p95: number
  readonly min: number
  readonly max: number
  readonly mad: number
}

export const summarize = (values: ReadonlyArray<number>): Summary | null => {
  if (values.length === 0) return null
  if (values.some((value) => !Number.isFinite(value))) throw new Error("Non-finite measurement")

  const sorted = values.slice().sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  const deviations = sorted.map((value) => Math.abs(value - median)).sort((a, b) => a - b)
  const mid = Math.floor(deviations.length / 2)
  const mad =
    deviations.length % 2 === 0 ? (deviations[mid - 1] + deviations[mid]) / 2 : deviations[mid]

  return {
    samples: values.length,
    median,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mad
  }
}

export const formatMs = (value: number | undefined): string =>
  value === undefined ? "n/a" : value.toFixed(2)
