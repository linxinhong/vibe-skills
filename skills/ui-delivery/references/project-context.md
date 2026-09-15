# Project context in .tasks

Make `.tasks/README.md` sufficient to orient a new reader: why the product exists, who uses it,
how its main objects and workflows connect, which decisions shaped it, what is implemented,
and where current work and evidence live. Use the user's language and concise concrete facts.

During authorized project setup, create the entry and fill it from repository evidence and
user decisions. Reuse authoritative documents via relative links; do not move or duplicate a
PRD, state machine, API contract or task registry merely to place it under `.tasks`.

Default documents when equivalent material does not exist:

- `.tasks/README.md`: short background and product summary, reading order, links to the map,
  design constraints, decision history, authoritative registry and current handoff. Include
  meaningful recent direction changes with links to evidence; never invent project history.
- `.tasks/product-map.md`: actors and goals; core objects and relationships; module ownership;
  key journeys; page responsibilities, routes, entry/exit and relevant permission boundaries.
  Distinguish intended product, observed implementation and known gaps using source links.
- `.tasks/decisions.md`: consequential product/interaction/architecture decisions with reason,
  source, affected scope, and supersession links. Link existing ADRs instead when available.

Keep task status and ownership in the registry. The overview links to current work and identifies
its evidence baseline rather than copying a second status ledger. For products with existing maps
elsewhere, the `.tasks` entry gives a useful summary and direct links so readers can navigate the
whole project from this directory. Missing facts are explicit unknowns, not filled-in guesses.

Maintenance responsibilities:

- Architect establishes or revises the product map and consequential decisions for changed scope.
- Coding Owner updates affected page/flow facts and links implementation evidence as part of delivery.
- Task Integrator checks the overview against integrated work; reports drift during audits and
  repairs it only when reconciliation/integration includes documentation updates.
- UI Delivery reads the overview and relevant map slice before proposing layouts; records accepted
  visual direction and its rationale alongside the existing task proposal.

Update relevant entries in the same delivery that changes them. A small fix needs no new history
document or project-wide rewrite. These roles share this convention; they do not each generate a map.
