type JsonScalar = string | number | boolean | null

type JsonValue = JsonScalar | JsonObject | ReadonlyArray<JsonValue>

interface JsonObject {
  readonly [key: string]: JsonValue | undefined
}

type WebDriverError = JsonObject & Readonly<{ error: string; message: string }>

type WebDriverCommand =
  | { readonly capabilities: { readonly alwaysMatch: { readonly browserName: string } } }
  | { readonly url: string }
  | { readonly script: string; readonly args: ReadonlyArray<string | number | boolean | null> }

type WebDriverResult =
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "state"; readonly status: string; readonly text: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "other" }

export {}

const Driver = process.env.WEBDRIVER_URL

const AppUrl = process.env.BROWSER_APP_URL ?? "http://127.0.0.1:5173/test/browser/"

const BrowserName = process.env.BROWSER_NAME ?? "chrome"

if (Driver === undefined) {
  throw new Error(
    "Set WEBDRIVER_URL to a running W3C WebDriver server (for example, http://127.0.0.1:9515)."
  )
}

const BaseUrl = Driver.replace(/\/$/, "")

// oxlint-disable-next-line better-antislop/no-unknown-parameters -- Response.json is untrusted until it is recursively checked as JSON.
const IsJsonScalar = (Value: unknown): Value is JsonScalar =>
  Value === null ||
  typeof Value === "string" ||
  typeof Value === "number" ||
  typeof Value === "boolean"

// oxlint-disable-next-line better-antislop/no-unknown-parameters -- Response.json is untrusted until it is recursively checked as JSON.
const IsJsonValue = (Value: unknown): Value is JsonValue =>
  IsJsonScalar(Value) || IsJsonArray(Value) || IsJsonObject(Value)

// oxlint-disable-next-line better-antislop/no-unknown-parameters -- nested JSON values are checked recursively.
const IsJsonArray = (Value: unknown): Value is ReadonlyArray<JsonValue> =>
  Array.isArray(Value) && Value.every(IsJsonValue)

function IsJsonObject(Value: JsonValue | undefined): Value is JsonObject
function IsJsonObject(Value: unknown): Value is JsonObject
// oxlint-disable-next-line better-antislop/no-unknown-parameters -- nested JSON values are checked recursively.
function IsJsonObject(Value: unknown): Value is JsonObject {
  return (
    typeof Value === "object" &&
    Value !== null &&
    !Array.isArray(Value) &&
    Object.values(Value).every(IsJsonValue)
  )
}

const IsWebDriverError = (Value: JsonValue): Value is WebDriverError =>
  IsJsonObject(Value) && IsString(Value.error) && IsString(Value.message)

// oxlint-disable-next-line better-antislop/no-unknown-parameters -- WebDriver protocol JSON is parsed immediately at this boundary.
const ParseWebDriverResult = (Payload: unknown): WebDriverResult => {
  if (!IsJsonObject(Payload)) throw new Error("WebDriver response was not a JSON object")

  const Value = Payload.value

  if (Value === undefined) {
    return IsString(Payload.sessionId)
      ? { kind: "session", sessionId: Payload.sessionId }
      : { kind: "other" }
  }

  if (IsWebDriverError(Value)) return { kind: "error", message: Value.message }

  if (HasStringField(Value, "sessionId")) {
    return { kind: "session", sessionId: Value.sessionId }
  }

  if (HasStateFields(Value)) {
    return { kind: "state", status: Value.status, text: Value.text }
  }

  return { kind: "other" }
}

const IsString = (Value: JsonValue | undefined): Value is string => typeof Value === "string"

const HasStringField = <Key extends string>(
  Value: JsonValue,
  KeyValue: Key
): Value is JsonObject & Readonly<Record<Key, string>> =>
  IsJsonObject(Value) && IsString(Value[KeyValue])

const HasStateFields = (
  Value: JsonValue
): Value is JsonObject & Readonly<{ status: string; text: string }> =>
  HasStringField(Value, "status") && HasStringField(Value, "text")

const WebDriverRequest = async (
  Path: string,
  Method: string,
  Body?: WebDriverCommand
): Promise<WebDriverResult> => {
  const Response = await fetch(`${BaseUrl}${Path}`, {
    method: Method,
    headers: { "content-type": "application/json" },
    body: Body === undefined ? undefined : JSON.stringify(Body)
  })

  const Payload: unknown = await Response.json()
  const Result = ParseWebDriverResult(Payload)

  if (Result.kind === "error")
    throw new Error(`WebDriver ${Method} ${Path} failed: ${Result.message}`)

  if (!Response.ok) {
    throw new Error(
      `WebDriver ${Method} ${Path} failed (${Response.status}): ${Response.statusText}`
    )
  }

  return Result
}

const Session = await WebDriverRequest("/session", "POST", {
  capabilities: { alwaysMatch: { browserName: BrowserName } }
})

if (Session.kind !== "session") throw new Error("WebDriver did not return a session identifier")

const SessionPath = `/session/${Session.sessionId}`

try {
  await WebDriverRequest(`${SessionPath}/url`, "POST", { url: AppUrl })

  const Deadline = Date.now() + 10_000
  let State: WebDriverResult = { kind: "other" }

  while (Date.now() < Deadline) {
    State = await WebDriverRequest(`${SessionPath}/execute/sync`, "POST", {
      script:
        "return { status: document.querySelector('#result')?.dataset.status ?? 'missing', text: document.querySelector('#result')?.textContent ?? '' }",
      args: []
    })

    if (State.kind === "state" && State.status === "passed") break

    if (State.kind === "state" && State.status === "failed") throw new Error(State.text)

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  if (State.kind !== "state" || State.status !== "passed") {
    throw new Error(`Browser smoke test did not finish before timeout: ${JSON.stringify(State)}`)
  }

  console.log(`Browser smoke test passed in ${BrowserName}: ${AppUrl}`)
} finally {
  await WebDriverRequest(SessionPath, "DELETE").catch(() => undefined)
}
