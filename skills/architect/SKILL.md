---
name: architect
description: >
  Define architecture boundaries and executable task cards for a requested feature or change.
  Use for design decisions and task decomposition; small implementation requests do not
  automatically require a planning phase or new documents.
metadata:
  version: "4.4"
  role: architect
---

# Architect

Produce the smallest design that resolves material uncertainty and lets implementation proceed.
Use the user's requested deliverables and the repository's existing design/task conventions.

## Task display names

In task descriptions, progress updates, tables, review requests, and handoffs, use
`任务名称（TASK-ID）`, for example `合同管理人工业务 Web（TASK-190）`, rather than a bare ID.
Resolve the title from the authoritative card; if unavailable, say `名称待核实（TASK-ID）`
instead of inventing one. Work without a card uses its descriptive name without a fabricated ID.
Keep raw IDs in commands, paths, branches, and structured registry fields; this is a display rule,
not a schema change. Carry the name/ID mapping and this rule into any delegated task brief.

## Establish the boundary

Use `.tasks/README.md` as the project context entry when present. When establishing or changing
project context, follow [the shared .tasks convention](../ui-delivery/references/project-context.md)
so product history, the map and decisions remain reachable from one place.

Read relevant repository instructions and evidence before designing. Capture:
- the observable outcome and why it is needed;
- current facts that affect the decision, with source paths;
- ownership, public contracts, data and trust boundaries that actually change;
- constraints, exclusions, compatibility and migration needs;
- significant risks, unresolved choices, and how success will be verified.

Separate verified facts from assumptions. Resolve routine choices using evidence and existing
authorization; ask only when an unresolved choice materially changes scope or outcome.
Do not create speculative infrastructure or impose generic constraints unrelated to the request.

Bound discovery before broad reads. Follow repository retrieval routing: exact anchors use the
available exact-search tool or rg; conceptual discovery uses ZG when available. Supply the
absolute workspace root, inspect result freshness, and treat sufficient source snippets as read.
If ZG is unavailable or irrelevant, use focused repository lookup. Persistent index lifecycle
changes require explicit authorization; a narrow index is not proof that other code is absent.
Stop discovery when the owner, existing seam, affected callers, and verification entry are known.

Describe what must hold and why. Leave local implementation choices to the implementer unless
a specific mechanism is necessary to preserve the contract. If implementation is also authorized,
continue into it after completing the design; the architect role is not an automatic stopping rule.

## Size and connect tasks

Use one card for a cohesive, independently verifiable outcome. Split where a stable contract,
separate ownership area, or independent deliverable makes execution easier to verify and integrate.
Do not split by file count or enforce a numerical threshold for task size.

For parallel work, establish shared contracts before dependent slices. State ownership of shared
files/contracts and dependency order; do not assign concurrent incompatible edits.
Identify genuinely independent lanes and a single integration writer. Contract consumers depend
on the contract card, not on an unnecessary chain of unrelated implementations. Parallelism is
an execution option within authorization, not a reason to split a cohesive card or launch agents.
A gate card verifies completed outputs. Extract missing product implementation into an owned card
instead of hiding it inside a broad integration/verification gate.

Use existing task documents. If none exist and persisted cards are requested, default to
.tasks/architecture.md and .tasks/tasks.yaml. Keep architecture decisions in the design document
and task status in the registry; avoid competing copies.

## Task contract

For business goals split across development cards, read
[Business Verifier stage contracts](../business-verifier/references/stage-contracts.md).
Create verification cards at runnable business milestones, reusing suitable existing Gate cards.
Express their expected business facts and make consumers that rely on those facts depend on the
verification card. Keep independent lanes parallel and the existing registry schema unchanged.
Plan backend stage checks before UI when runnable, then full user-journey acceptance when connected.
Name the required independence and environment; leave test execution to Business Verifier.

For business Web UI cards, read [UI Delivery](../ui-delivery/SKILL.md) for project configuration,
visible interaction proposals and the review boundary. Link that proposal and decision from
the existing design/card, and express acceptance as actor/action/result scenarios. Reuse an
accepted proposal; a planning-only request remains planning-only.

Each card needs a goal, scope, acceptance, dependencies, and risk appropriate to the work.
Add constraints, prohibited shortcuts, investigation hints, and escalation conditions only when
they change implementation decisions. Acceptance should identify observable behavior and suitable
repository-native checks, not just say "tests pass."

Make substantial cards executable without another repository-wide scout. Use existing fields
such as scope, investigation_hints, constraints, and acceptance; do not add required schema fields
or duplicate architecture prose. Supply:

- **Entry map:** owning semantic root, likely implementation/test paths, reusable contract or
  comparable implementation, and the boundary outside scope. Mark unverified paths as leads.
  This is a starting map, not a file allow-list: trace affected callers when evidence requires it.
- **Preflight:** existing behavior versus target; relevant generator/Spec ownership and any
  compatibility rule likely to invalidate the approach. Distinguish declared contracts from
  runtime-registered capabilities. Resolve shared-contract uncertainty before dependent coding.
- **Verification ladder:** closest behavioral test, affected-boundary gate, and conditions that
  require broader race, database, browser, or release checks. Preserve mandatory repository gates.
  Map acceptance to observable scenarios, including relevant failure, permission, serialization,
  or migration behavior; record environment needs and rollback/degradation expectations.

Keep small cards short. Reuse established commands and fixtures rather than prescribing new
infrastructure. Name any necessary independent review and its question for high-impact contract,
security, or data changes; passing implementation tests alone does not answer that question.

For a new registry using the bundled tasks CLI, retain this compatible shape:

```yaml
version: 1
project:
  name: "Project name"
feature:
  title: "Feature name"
  status: in_progress
tasks:
  - id: TASK-001
    title: "One observable outcome"
    status: ready
    goal: "Describe the required behavior"
    scope:
      in: ["Included responsibility"]
      out: ["Excluded responsibility"]
    constraints: []
    forbidden: []
    acceptance:
      - type: assertion
        expect: "A concrete observable result"
    dependencies: []
    risk_level: L1
    investigation_hints: []
    escalation_conditions: []
    result:
      owner: null
      attempts: 0
      claimed_at: null
      completed_at: null
      worktree: null
      branch: null
      evidence: []
      follow_up_candidates: []
```

`project.name` is the stable project identity used by project-wide previews and reports.
`feature.title` names the current delivery theme and must not substitute for the project name.
When initializing a registry, derive the project name from explicit project context or the
repository's established product name; if neither exists, use the repository directory name
rather than inventing a product brand.

Replace example values with task-specific content. Use command acceptance entries with type:
command and run: "<actual repository command>" when applicable. Do not invent test infrastructure
merely to fit the schema.

Supported statuses: pending, ready, in_progress, blocked, needs_arch_review, done, failed.
Ready means all dependencies are done on main. Done means integrated, verified on main, and
recorded there. Failed records an evidence-backed unsuccessful outcome requiring disposition,
not the exhaustion of an arbitrary retry count.
Preserve an established repository schema rather than migrating it to this example.

Risk labels describe review/verification needs: L1 local, L2 cross-module, L3 contract/data/runtime,
L4 architecture/security/critical-system. They do not independently create approval gates;
identify any actual required review in the card.

## Validate and hand off

For a requested visual roadmap, use Task Integrator's
[generic preview format](../task-integrator/references/preview.md). Store only authorized
milestone/task mappings and explicit planned dates in optional project data; keep live status
in the registry. Unscheduled milestones remain undated, and completion alone is not release evidence.

Check dependency IDs/cycles, ownership boundaries, acceptance feasibility, and that every
implementation card has a coherent result. Use the repository validator; the bundled tool is:

```sh
node ~/.agents/skills/task-integrator/bin/tasks.mjs validate --registry <registry-path>
```

The bundled CLI currently uses main and a limited YAML parser. Use repository-native tooling
when those assumptions do not fit. Claims and completion belong to the mechanical ownership
workflow, not speculative updates made during planning.

Coding Owner implements and integrates when authorized. Task Integrator audits and handles
authorized integration coordination. Neither role must perform a redundant review of every step.
For an escalation, change only the boundary/card affected by the new evidence, preserve work
already completed, and state the decision plus its effect on dependencies and acceptance.
