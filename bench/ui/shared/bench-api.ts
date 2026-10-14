import type { KeyedOperation } from "./workloads.js"

export interface KeyedSample {
  readonly operation: KeyedOperation
  readonly elapsedMs: number
  readonly rowCount: number
  readonly checksum: number
  readonly readinessChecks: number
}

export interface ThroughputSample {
  readonly completedOperations: number
  readonly elapsedMs: number
  readonly operationsPerSecond: number
}

export interface StaticSample {
  readonly mountMs: number
  readonly rowCount: number
}

export interface DisposeSample {
  readonly disposeMs: number
}

export interface SignalSample {
  readonly elapsedMs: number
  readonly bindings: number
}

export interface UiBenchApi {
  readonly resetKeyed: (operation: KeyedOperation) => Promise<void>
  readonly runKeyed: (operation: KeyedOperation) => Promise<KeyedSample>
  readonly mountStatic: () => Promise<StaticSample>
  readonly disposeStatic: () => Promise<DisposeSample>
  readonly prepareSignals: () => Promise<void>
  readonly runSignals: () => Promise<SignalSample>
  readonly prepareThroughput: () => Promise<void>
  readonly throughput: (durationMs: number) => Promise<ThroughputSample>
}

declare global {
  interface Window {
    __uiBench?: UiBenchApi
    __uiBenchReady?: boolean
    __uiBenchBootMs?: number
    __uiBenchError?: string
  }
}

export {}
