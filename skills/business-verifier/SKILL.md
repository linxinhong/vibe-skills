---
name: business-verifier
description: >
  Plan and execute Agent-led business verification cards at runnable milestones across
  multiple development cards. Use for staged business acceptance, cross-owner outcome
  checks, defect reproduction, and reusable regression evidence.
metadata:
  version: "1.0"
  role: business-verifier
---

# Business Verifier

Prove that a bounded business journey produces the required outcome on a named revision.
Stage verification around runnable business milestones spanning one or more development cards.
Keep implementation checks with their owners and accumulate reusable business regression coverage.

## Route and scope

- When planning verification cards or their dependencies, read
  [stage contracts](references/stage-contracts.md) and use
  [Architect](../architect/SKILL.md) for authorized card definitions.
- When executing an existing verification card, use
  [Coding Owner](../coding-owner/SKILL.md) for claim, isolated worktree, environment preparation,
  and completion mechanics. This skill defines verification work inside that ownership workflow.
- For browser acceptance, consume the existing UI proposal and scenario evidence; read
  [UI Delivery](../ui-delivery/SKILL.md) for relevant acceptance rules. Verification of an
  accepted UI does not require a fresh design proposal or generated image.
- Use [Task Integrator](../task-integrator/SKILL.md) for status audits and authorized integration.
  Audit-only requests stay read-only. These links do not start other agents or expand authority.

Use the repository's authoritative registry, status vocabulary, evidence location, and task tool.
Display tasks as `任务名称（TASK-ID）`; resolve titles from cards and retain raw IDs in machine fields.
If no title is available, use `名称待核实（TASK-ID）`. Pass this convention into delegated briefs.

## Establish the verification target

Read the card and authoritative business rules before examining implementation tests. Record
actors, initial conditions, transitions, expected outcomes, and the source establishing each
expectation. Then inspect implementation seams and existing coverage to find additional risks.
An assertion copied from current behavior is not an independent business expectation.

Pin the tested commit, relevant local diff if any, configuration, runtime providers and data setup.
Prepare isolated accounts and resettable synthetic data using existing fixtures and runners.
Discover actual registered APIs and entry points; a declared contract alone does not prove a
running capability. Probe environment readiness before expensive checks.

Each required outcome needs a way to observe truth: authorized API responses, owner-provided
queries, or scoped test-harness persistence assertions allowed by repository policy. Browser
success messages alone cannot prove durable writes or consistency across owners. Verification
does not authorize cross-owner production SQL or changes to business authorization boundaries.

If the business rule is ambiguous, record the unresolved expectation and continue independent
scenarios. If a required runtime or decision is unavailable, mark affected scenarios unverified.
Do not invent an expected result or count unavailable infrastructure as a product failure.

## Build and execute the scenario set

Map each card acceptance requirement to stable scenario IDs and evidence. Use the stage-contract
reference when creating a scenario record. Select cases by business risk rather than test count:

- Normal completion and meaningful boundary values.
- Relevant denied access, revoked permissions, duplicate requests and conflicting transitions.
- For durable or cross-owner writes: dependency success followed by local failure, restart/retry,
  and competing cancellation or version changes; check both owners and recovery state.
- For financial or allocation facts: conservation, no double counting, and defined rounding/units.
- For UI journeys: entry to result, refresh persistence, retained failed input, recovery, and the
  card's viewport/accessibility requirements.

Use deterministic service/API/database tests for state, permissions, concurrency and recovery.
Use browser automation for critical user journeys and exploratory Computer Use for interaction
gaps. Inspect unexpected behavior and preserve useful reproductions as automated regression
tests at the cheapest layer that still proves the behavior. Use synchronization barriers or
controlled faults for concurrency tests rather than hoping timing reproduces the problem.

For AI-assisted flows, separately verify deterministic authorization, confirmation, structured
output validation and fallback behavior. Evaluate model output against stated factual/quality
criteria with bounded representative samples; one plausible answer does not prove reliability.
Use authorized providers and budgets, and identify simulated versus real provider execution.

Reuse predecessor regression scenarios by reference. Run affected regressions plus the stage's
new scenarios; run broader suites when required by policy or changes to shared behavior.
Explain reuse through unchanged code, contracts, configuration and environment. Relevant changes
invalidate affected evidence; an evidence-only edit alone does not require a full rerun.

## Independence and defect loop

Prefer a verifier who did not author the implementation. When delegation is explicitly authorized,
give that agent the business contract, revision, entry map and environment, and let it derive
scenarios before reading implementation conclusions. Assign exclusive test/artifact ownership
and isolated data. When performed by the implementer, label verification as self-verification;
honor any card-required independent review. Skill invocation alone does not authorize delegation.

On failure, capture minimal setup, actor, operations, expected versus observed facts, tested
revision, reproducible command or steps, and affected owner. Distinguish product defect,
test-harness defect, environment failure, and unresolved specification. Fix owned harness issues
without weakening assertions. Route product fixes to their implementation owner or an authorized
repair card; substantial missing product behavior belongs in a development card.

Keep blocking defects open until retested on the repaired revision. For an already completed
development card, create/link an authorized repair card rather than silently rewriting historical
completion. The repair must not depend on completion of the failing verification card; verification
resumes after the repair, preserving an acyclic graph. Record external issue creation or messages
only within granted authority. Without that authority, persist the defect in the local evidence.

## Evidence and completion

For visual verification progress, use the Task Integrator
[project preview](../task-integrator/references/preview.md). Link explicit verification cards
and evidence through project data; the viewer must not infer verified coverage from card counts.

Reuse the project's evidence directory; otherwise use `.tasks/verification/<task-id>/` for compact,
sanitized scenario/results records and regression pointers. Keep credentials, storage state and
raw sensitive traces outside tracked artifacts. Evidence records facts; registry fields own status.

For each scenario record expected and observed results, pass/fail/unverified, exact command or
browser steps, tested revision, environment mode, and artifact/test location. Keep an aggregate
summary of required scenarios passed, failed and unverified, blocking defects, and remaining risks.
Generated tests, executed tests and passed tests are distinct. Build success or screenshots cannot
substitute for an unexecuted business acceptance requirement.

Complete the verification card only when all required outcomes are exercised successfully,
blocking defects are closed by retest, and evidence applies to the integrated revision under the
repository's completion policy. Any authorized scope revision must be explicit in the card; do
not convert skipped requirements to passes. Use the existing completion tool and evidence shape.

Report the verified business outcome, its limits, proving revision and next dependency unlocked.
Development completion, stage verification, full user-journey acceptance and production deployment
are separate claims; a stage pass proves only its named scope and environment.
