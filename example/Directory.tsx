import { Component, ErrorBoundary, Form, Link, Route, Router, Signal } from "@effect/ui"
import { Effect } from "effect"

const HomeRoute = (Anchor: Component.Component<Link.Props>) =>
  Route.make("/", {
    metadata: {
      title: "Member directory — @effect/ui",
      description: "Browse a typed, Effect-powered member directory."
    },
    render: () => (
      <section>
        <h3>Directory</h3>
        <p>Choose a profile to load its route asynchronously.</p>
        <Anchor to="/members/ada">Ada Lovelace</Anchor>
        <p>
          <Anchor to="/reports">Open the lazy reports route</Anchor>
        </p>
      </section>
    )
  })

const MemberRoute = Route.make("/members/:id", {
  metadata: (location) => ({
    title: `Member ${location.params.id} — @effect/ui`,
    description: `Profile and contact information for ${location.params.id}.`
  }),
  layout: (location, child) => (
    <article aria-labelledby="member-heading">
      <h3 id="member-heading">Member {location.params.id}</h3>
      {child}
    </article>
  ),
  load: (location) =>
    Effect.promise(
      () =>
        new Promise<JSX.Element>((resolve) => {
          setTimeout(() => resolve(<p>Loaded profile for {location.params.id}</p>), 150)
        })
    ),
  pending: <p role="status">Loading profile…</p>,
  error: (cause) => <p role="alert">Could not load profile: {String(cause)}</p>
})

const ReportsRoute = (Anchor: Component.Component<Link.Props>) =>
  Route.make("/reports", {
    lazy: async () => {
      const Reports = await import("./Reports")

      return { default: (location: Router.RouteLocation) => Reports.default(location, Anchor) }
    },
    metadata: {
      title: "Reports — @effect/ui",
      description: "A lazily loaded route module with route-scoped document metadata."
    },
    pending: <p role="status">Loading reports module…</p>,
    error: (cause) => <p role="alert">Could not load reports: {String(cause)}</p>
  })

const MakeDirectoryRouter = Effect.gen(function* () {
  const Anchor = yield* Link.make()

  const Outlet = yield* Router.make({
    routes: [HomeRoute(Anchor), MemberRoute, ReportsRoute(Anchor)],
    notFound: <p role="status">That directory page was not found.</p>,
    onAfterNavigate: ({ to }) => console.info("Navigated to", to.pathname)
  })

  return Component.sync(() => (
    <>
      <nav aria-label="Directory routes">
        <Anchor to="/" end>
          Directory home
        </Anchor>
      </nav>
      <Outlet />
    </>
  ))
})

type ContactFormState = Form.FormState<{ readonly email: string }, string>

interface ContactFieldsProps {
  readonly form: ContactFormState
  readonly email: Form.FormField<string>
  readonly message: Signal.Source<string>
  readonly invalid: Signal.Source<boolean>
}

const ContactFields = Component.sync<ContactFieldsProps>((props) => (
  <form onSubmit={props.form.onSubmit}>
    <label htmlFor="directory-email">Contact email</label>
    <input
      id="directory-email"
      type="email"
      autoComplete="email"
      value={props.email.value}
      aria-invalid={props.invalid}
      aria-describedby="directory-email-error"
      onInput={(event) => {
        const NextEmail = event.currentTarget.value

        return props.email.set(NextEmail)
      }}
    />
    <p id="directory-email-error" role="alert">
      {props.message}
    </p>
    <button type="submit" disabled={props.form.submitting}>
      Send contact request
    </button>
    <button type="reset" onClick={props.form.reset}>
      Reset
    </button>
  </form>
))

const DirectoryPage = (
  form: ContactFormState,
  email: Form.FormField<string>,
  message: Signal.Source<string>,
  invalid: Signal.Source<boolean>,
  DirectoryRouter: Component.Component
) => (
  <ErrorBoundary.View fallback={<p role="alert">The directory failed to render.</p>}>
    <section aria-labelledby="directory-title">
      <h2 id="directory-title">Member directory</h2>
      <ContactFields form={form} email={email} message={message} invalid={invalid} />
      <DirectoryRouter />
    </section>
  </ErrorBoundary.View>
)

export const DirectoryView = Component.make(
  Effect.gen(function* () {
    const DirectoryRouter = yield* MakeDirectoryRouter

    return () =>
      Effect.gen(function* () {
        const ContactForm = yield* Form.make({
          initial: { email: "" },
          validate: ({ email }) =>
            Effect.succeed(email.includes("@") ? [] : ["Enter a valid email address"]),
          onSubmit: ({ email }) => Effect.sync(() => console.info("Contact request", email))
        })

        const Email = yield* Form.field(ContactForm.values, "email")
        const ValidationMessage = yield* Signal.map(ContactForm.errors, (issues) => issues[0] ?? "")

        const HasValidationError = yield* Signal.map(
          ContactForm.errors,
          (issues) => issues.length > 0
        )

        return DirectoryPage(
          ContactForm,
          Email,
          ValidationMessage,
          HasValidationError,
          DirectoryRouter
        )
      })
  })
)
