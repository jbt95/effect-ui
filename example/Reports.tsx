import { Link } from "@effect/ui"
import type { RouteLocation } from "@effect/ui"

const Reports = (location: RouteLocation) => (
  <section aria-labelledby="reports-title">
    <h4 id="reports-title">Reports</h4>
    <p>This screen was imported only when its route was requested.</p>
    <p>Current path: {location.pathname}</p>
    <Link to="/" end>
      Return to the directory
    </Link>
  </section>
)

export default Reports
