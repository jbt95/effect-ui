import type { Component, Link, Router } from "@effect/ui"

// The lazy module receives an already-acquired anchor from its route factory.
const Reports = (location: Router.RouteLocation, Anchor: Component.Component<Link.Props>) => (
  <section aria-labelledby="reports-title">
    <h4 id="reports-title">Reports</h4>
    <p>This screen was imported only when its route was requested.</p>
    <p>Current path: {location.pathname}</p>
    <Anchor to="/" end>
      Return to the directory
    </Anchor>
  </section>
)

export default Reports
