export interface VirtualRange {
  readonly start: number
  readonly end: number
  readonly offset: number
  readonly totalSize: number
}

export type VirtualKey = string | number

export const ValidateIdentity = (Id: string, Name: string): void => {
  if (Id.trim().length === 0 || /\s/.test(Id)) {
    throw new TypeError(`[@effect/ui] ${Name} must be non-empty and contain no whitespace`)
  }
}

export const ValidateOverscan = (Overscan: number): void => {
  if (!Number.isSafeInteger(Overscan) || Overscan < 0) {
    throw new RangeError("[@effect/ui] virtualizer overscan must be a non-negative integer")
  }
}

export const ValidatePositiveSize = (Size: number, Name: string): void => {
  if (!Number.isFinite(Size) || Size <= 0) {
    throw new RangeError(`[@effect/ui] ${Name} must be a positive finite number`)
  }
}

export const ValidateVirtualKeys = <A>(
  Items: ReadonlyArray<A>,
  KeyOf: (Item: A) => VirtualKey,
  Name: string
): ReadonlyArray<VirtualKey> => {
  const Keys: Array<VirtualKey> = []
  const Seen = new Set<VirtualKey>()

  for (const Item of Items) {
    const Key = KeyOf(Item)

    if (!IsVirtualKey(Key)) {
      throw new TypeError(`[@effect/ui] ${Name} keys must be strings or finite numbers`)
    }

    if (Seen.has(Key)) throw new TypeError(`[@effect/ui] ${Name} keys must be unique`)

    Seen.add(Key)
    Keys.push(Key)
  }

  return Keys
}

export const KeyToken = (Key: VirtualKey): string => {
  if (IsNumericKey(Key)) {
    const Value = String(Key)

    return `number-${Value.length}-${Value}`
  }

  const Encoded = EncodeStringKey(Key)

  return `string-${Encoded.length}-${Encoded}`
}

const ValidateRangeInputs = (
  Count: number,
  ItemSize: number,
  ViewportSize: number,
  Overscan: number
): number => {
  if (!Number.isSafeInteger(Count) || Count < 0) {
    throw new RangeError("[@effect/ui] virtualizer item count must be a non-negative integer")
  }

  ValidatePositiveSize(ItemSize, "virtualizer item size")
  ValidatePositiveSize(ViewportSize, "virtualizer viewport size")
  ValidateOverscan(Overscan)
  const TotalSize = Count * ItemSize

  if (!Number.isFinite(TotalSize)) {
    throw new RangeError("[@effect/ui] virtualizer total size must be finite")
  }

  return TotalSize
}

const IsVirtualKey = (Value: unknown): Value is VirtualKey =>
  typeof Value === "string" || (typeof Value === "number" && Number.isFinite(Value))

const IsNumericKey = (Value: VirtualKey): Value is number => typeof Value === "number"

const EncodeStringKey = (Value: string): string => {
  try {
    return encodeURIComponent(Value).replaceAll("-", "%2D")
  } catch {
    let Encoded = "utf16"

    for (let Index = 0; Index < Value.length; Index += 1) {
      Encoded += Value.charCodeAt(Index).toString(16).padStart(4, "0")
    }

    return Encoded
  }
}

export const FixedRange = (
  Count: number,
  ItemSize: number,
  ViewportSize: number,
  ScrollOffset: number,
  Overscan: number
): VirtualRange => {
  const TotalSize = ValidateRangeInputs(Count, ItemSize, ViewportSize, Overscan)
  const SafeOffset = NormalizeScrollOffset(ScrollOffset, TotalSize, ViewportSize)
  const VisibleStart = Math.min(Count, Math.floor(SafeOffset / ItemSize))
  const VisibleEnd = Math.min(Count, Math.ceil((SafeOffset + ViewportSize) / ItemSize))
  const Start = Math.max(0, VisibleStart - Overscan)
  const End = Math.min(Count, VisibleEnd + Overscan)

  return {
    start: Start,
    end: Math.max(Start, End),
    offset: Start * ItemSize,
    totalSize: TotalSize
  }
}

export const NormalizeScrollOffset = (
  ScrollOffset: number,
  TotalSize: number,
  ViewportSize: number
): number => {
  const MaxOffset = Math.max(0, TotalSize - ViewportSize)

  return Number.isFinite(ScrollOffset) ? Math.max(0, Math.min(ScrollOffset, MaxOffset)) : 0
}
