interface Sample {
  readonly rows: number
  readonly operation?: string
  readonly elapsedMs?: number
  readonly mountMs?: number
  readonly disposeMs?: number
  readonly operationsPerSecond?: number
}

export interface Report {
  readonly generatedAt: string
  readonly sourceHash: string
  readonly browserVersion?: string
  readonly keyed: ReadonlyArray<Sample>
  readonly static: ReadonlyArray<Sample>
  readonly signals: ReadonlyArray<Sample>
  readonly throughput: ReadonlyArray<Sample>
}

export interface DeltaRow {
  readonly key: string
  readonly baseMedian: number
  readonly nextMedian: number
  readonly deltaPct: number
  readonly baseSamples: number
  readonly nextSamples: number
}

const median = (values: ReadonlyArray<number>): number => {
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

const pick = (
  samples: ReadonlyArray<Sample>,
  rows: number,
  operation: string | undefined,
  field: "elapsedMs" | "mountMs" | "disposeMs" | "operationsPerSecond"
): Array<number> =>
  samples
    .filter(
      (sample) =>
        sample.rows === rows && (operation === undefined || sample.operation === operation)
    )
    .map((sample) => sample[field] ?? Number.NaN)
    .filter((value) => Number.isFinite(value))

const rowCounts = (report: Report): Array<number> =>
  Array.from(new Set(report.keyed.map((sample) => sample.rows))).sort((a, b) => a - b)

const operations = (report: Report): Array<string> =>
  Array.from(
    new Set(
      report.keyed.flatMap((sample) => (sample.operation === undefined ? [] : [sample.operation]))
    )
  )

export const compareReports = (base: Report, next: Report): Array<DeltaRow> => {
  const rows: Array<DeltaRow> = []
  const counts = rowCounts(next)

  for (const rowCount of counts) {
    for (const operation of operations(next)) {
      const baseValues = pick(base.keyed, rowCount, operation, "elapsedMs")
      const nextValues = pick(next.keyed, rowCount, operation, "elapsedMs")

      if (baseValues.length === 0 || nextValues.length === 0) continue

      const baseMedian = median(baseValues)
      const nextMedian = median(nextValues)
      rows.push({
        key: `keyed ${rowCount} ${operation}`,
        baseMedian,
        nextMedian,
        deltaPct: baseMedian === 0 ? 0 : ((nextMedian - baseMedian) / baseMedian) * 100,
        baseSamples: baseValues.length,
        nextSamples: nextValues.length
      })
    }

    for (const [label, field] of [
      ["static-mount", "mountMs"],
      ["static-dispose", "disposeMs"]
    ] as const) {
      const baseValues = pick(base.static, rowCount, undefined, field)
      const nextValues = pick(next.static, rowCount, undefined, field)

      if (baseValues.length === 0 || nextValues.length === 0) continue

      const baseMedian = median(baseValues)
      const nextMedian = median(nextValues)
      rows.push({
        key: `${label} ${rowCount}`,
        baseMedian,
        nextMedian,
        deltaPct: baseMedian === 0 ? 0 : ((nextMedian - baseMedian) / baseMedian) * 100,
        baseSamples: baseValues.length,
        nextSamples: nextValues.length
      })
    }

    const baseSignals = pick(base.signals, rowCount, undefined, "elapsedMs")
    const nextSignals = pick(next.signals, rowCount, undefined, "elapsedMs")

    if (baseSignals.length > 0 && nextSignals.length > 0) {
      const baseMedian = median(baseSignals)
      const nextMedian = median(nextSignals)
      rows.push({
        key: `signals ${rowCount}`,
        baseMedian,
        nextMedian,
        deltaPct: baseMedian === 0 ? 0 : ((nextMedian - baseMedian) / baseMedian) * 100,
        baseSamples: baseSignals.length,
        nextSamples: nextSignals.length
      })
    }

    const baseThroughput = pick(base.throughput, rowCount, undefined, "operationsPerSecond")
    const nextThroughput = pick(next.throughput, rowCount, undefined, "operationsPerSecond")

    if (baseThroughput.length > 0 && nextThroughput.length > 0) {
      const baseMedian = median(baseThroughput)
      const nextMedian = median(nextThroughput)
      rows.push({
        key: `throughput ${rowCount}`,
        baseMedian,
        nextMedian,
        deltaPct: baseMedian === 0 ? 0 : ((nextMedian - baseMedian) / baseMedian) * 100,
        baseSamples: baseThroughput.length,
        nextSamples: nextThroughput.length
      })
    }
  }

  return rows
}
