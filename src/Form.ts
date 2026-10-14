import { Effect } from "effect"
import type { Context as EffectContext, Scope } from "effect"
import type { NativeEventHandler } from "./Element.js"
import { Signal, type SignalSource } from "./Signal.js"

/**
 * Declares a controlled form: initial values, a validator returning
 * user-facing issues as data, and a submit Effect that runs only when valid.
 * Validation and submission requirements are captured, so `make` is how
 * forms close over services before entering a renderer.
 */
export interface FormOptions<A, Issue, EValidation, ESubmit, RValidation, RSubmit> {
  /** Initial controlled values. */
  readonly initial: A
  /** Validates one submitted snapshot; return issues rather than failing for user input. */
  readonly validate: (values: A) => Effect.Effect<ReadonlyArray<Issue>, EValidation, RValidation>
  /** Runs only when validation returns no issues. */
  readonly onSubmit: (values: A) => Effect.Effect<void, ESubmit, RSubmit>
}

/**
 * A single controlled field: a read-only reactive value plus immutable `set`
 * and `update` actions that preserve sibling values. Create with
 * `Form.field` inside the owning scope.
 */
export interface FormField<Value> {
  /** Reactive read-only value for JSX properties and text children. */
  readonly value: SignalSource<Value>
  /** Replace this field while preserving the other form values. */
  readonly set: (value: Value) => Effect.Effect<void>
  /** Update this field while preserving the other form values. */
  readonly update: (f: (value: Value) => Value) => Effect.Effect<void>
}

/**
 * Controlled form state. `values` is writable; `errors` and `submitting`
 * are read-only. `submit` runs validation then submission (skipping
 * submission while issues remain) and ignores duplicate active submissions;
 * `reset` restores initial values. Validation issues stay data — typed
 * Effect failures still propagate to error handling.
 */
export interface FormState<A, Issue, EValidation = never, ESubmit = never> {
  readonly values: Signal<A>
  readonly errors: SignalSource<ReadonlyArray<Issue>>
  readonly submitting: SignalSource<boolean>
  readonly submit: Effect.Effect<void, EValidation | ESubmit, never>
  readonly reset: Effect.Effect<void>
  readonly onSubmit: NativeEventHandler<SubmitEvent, HTMLFormElement>
}

/**
 * Creates a reactive field over one key of a form-values signal. The field
 * value follows the form; writes preserve every other field. Scoped to the
 * calling Effect — create fields inside the owning renderer.
 */
export const field = <A extends object, K extends keyof A>(
  Values: Signal<A>,
  Name: K
): Effect.Effect<FormField<A[K]>, never, Scope.Scope> =>
  Effect.map(
    Signal.memo([Values], () => Values.value[Name]),
    (Value) => ({
      value: Value,
      set: (Next) => Values.update((Current) => ({ ...Current, [Name]: Next })),
      update: (Update) =>
        Values.update((Current) => ({ ...Current, [Name]: Update(Current[Name]) }))
    })
  )

const ResetFormState = <A, Issue>(
  Values: Signal<A>,
  Errors: Signal<ReadonlyArray<Issue>>,
  Submitting: Signal<boolean>,
  Initial: A
) =>
  Effect.gen(function* () {
    yield* Values.set(Initial)
    yield* Errors.set([])
    yield* Submitting.set(false)
  })

const RunFormSubmission = <A, Issue, EValidation, ESubmit, RValidation, RSubmit>(
  options: FormOptions<A, Issue, EValidation, ESubmit, RValidation, RSubmit>,
  values: Signal<A>,
  errors: Signal<ReadonlyArray<Issue>>,
  submitting: Signal<boolean>,
  context: EffectContext.Context<RValidation | RSubmit>
): Effect.Effect<void, EValidation | ESubmit> =>
  Effect.gen(function* () {
    yield* submitting.set(true)

    yield* Effect.gen(function* () {
      const Snapshot = values.value
      const Issues = yield* Effect.provideContext(options.validate(Snapshot), context)
      yield* errors.set(Issues)

      if (Issues.length === 0) {
        yield* Effect.provideContext(options.onSubmit(Snapshot), context)
      }
    }).pipe(Effect.ensuring(submitting.set(false)))
  })

const CreateFormSubmit = <A, Issue, EValidation, ESubmit, RValidation, RSubmit>(
  options: FormOptions<A, Issue, EValidation, ESubmit, RValidation, RSubmit>,
  values: Signal<A>,
  errors: Signal<ReadonlyArray<Issue>>,
  submitting: Signal<boolean>,
  context: EffectContext.Context<RValidation | RSubmit>
): Effect.Effect<void, EValidation | ESubmit> => {
  let SubmissionActive = false

  return Effect.suspend(() => {
    if (SubmissionActive) return Effect.void

    SubmissionActive = true

    return RunFormSubmission(options, values, errors, submitting, context).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          SubmissionActive = false
        })
      )
    )
  })
}

/**
 * Creates controlled form state with a validation-gated submit handler.
 * `onSubmit` in the returned state prevents native navigation for you.
 * For per-instance forms, bind submission dependencies first and create the
 * form inside the renderer.
 *
 * ```tsx
 * const form = yield* Form.make({
 *   initial: { email: "" },
 *   validate: ({ email }) => Effect.succeed(email.includes("@") ? [] : ["Enter an email"]),
 *   onSubmit: ({ email }) => api.save(email)
 * })
 * ```
 */
export const createForm = <
  A,
  Issue,
  EValidation = never,
  ESubmit = never,
  RValidation = never,
  RSubmit = never
>(
  options: FormOptions<A, Issue, EValidation, ESubmit, RValidation, RSubmit>
): Effect.Effect<FormState<A, Issue, EValidation, ESubmit>, never, RValidation | RSubmit> =>
  Effect.gen(function* () {
    const Context = yield* Effect.context<RValidation | RSubmit>()

    const Signals = yield* Effect.all({
      values: Signal.make(options.initial),
      errors: Signal.make<ReadonlyArray<Issue>>([]),
      submitting: Signal.make(false)
    })

    const { values, errors, submitting } = Signals
    const submit = CreateFormSubmit(options, values, errors, submitting, Context)

    const reset = ResetFormState(values, errors, submitting, options.initial)

    const onSubmit: NativeEventHandler<SubmitEvent, HTMLFormElement> = (event) => {
      event.preventDefault()

      return submit
    }

    return {
      values,
      errors: Signal.readonly(errors),
      submitting: Signal.readonly(submitting),
      submit,
      reset,
      onSubmit
    }
  })

/** Canonical form constructor. See `createForm`. */
export const make = createForm

/** Runs a form's validation-gated submission. Module-level access to `state.submit`. */
export const submit = <A, Issue, EV, ES>(self: FormState<A, Issue, EV, ES>) => self.submit

/** Restores a form's initial values and clears issues. Module-level access to `state.reset`. */
export const reset = <A, Issue, EV, ES>(self: FormState<A, Issue, EV, ES>) => self.reset

/** Controlled forms with validation-gated submission. See `FormState`. */
export const Form = { make, field, submit, reset }
