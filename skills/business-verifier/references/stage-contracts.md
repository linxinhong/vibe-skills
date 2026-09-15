# Stage verification contracts

Read this when defining stage cards, dependency edges or scenario/evidence records.

## Choose milestones

Place verification after the smallest integrated slice that produces a meaningful business
result, especially before later work relies on cross-owner state, money or permissions.
A backend milestone can be verified through real service/API and persistence paths before UI
exists. Add browser acceptance when the user-facing journey is runnable. Use existing suitable
Gate cards instead of creating duplicates; preserve their historical completion and scope.

Example sequence (descriptive names, not allocated task IDs):

```text
Contracts + requisition/approval + ordering
  → Verify requisition to order and budget commitment
  → Receipt/return implementation
  → Verify acceptance, return and cost consistency
  → Complete purchasing UI
  → Verify the real user journey
```

Independent development lanes may proceed concurrently. Add a verification dependency only where
the consumer relies on that verified behavior. Create the cards during architecture planning,
not only after all implementation is complete. Keep local developer tests mandatory as scoped.

## Use the current registry schema

Represent verification as an ordinary card. Use existing fields; do not require new statuses,
task types, a second registry or changes to the task CLI. Put detailed scenario records in a
linked artifact only when the card would otherwise become unwieldy.

Card contents:

| Existing field | Verification meaning |
| --- | --- |
| title | Named business milestone + 阶段验证 / 业务验收 |
| goal | The observable business result being established |
| scope.in | Journey boundaries, owners, test/harness and evidence responsibilities |
| scope.out | Later journeys, production actions, product implementation outside verification |
| dependencies | Required development cards and applicable prior stage verification |
| acceptance | Actor, setup, operation, expected facts, failure cases and evidence requirement |
| investigation_hints | Rule sources, runtime entry points, fixtures and prior regression pointers |
| constraints | Environment needs, independence requirement, isolation and compatibility |
| result.evidence | Existing CLI-compatible records linking scenarios and tested revision |

Allocate IDs through the repository's convention. Set readiness from actual integrated dependencies.
Downstream cards depend explicitly on the stage verifier where appropriate; a prose mention alone
does not block readiness. Validate the graph after authorized edits. For an existing failing stage,
authorized repair cards depend on the relevant implementation, not on the failing verifier; add
the repair prerequisite to the verifier through the repository's supported workflow.

## Scenario record template

Use one compact table or the repository's established test-case format:

```text
Scenario ID / business acceptance requirement:
Rule source and expected invariant:
Actor, permissions and starting data:
Operations / injected failure or concurrency ordering:
Expected visible result and authoritative business facts:
Execution layer and reusable test/command:
Observed result / pass | fail | unverified:
Tested commit (+ local diff identity if applicable), environment and fixture mode:
Evidence location / defect link:
```

For example, if the approved contract requires cancelled orders to release commitments, verify
remote budget success followed by a competing cancellation and failed local save. Observe the
final order, commitment and recovery state. Take the expected convergence and deadline from the
actual contract; if absent, raise the missing decision instead of inventing release semantics.

## Evidence reuse and progress

Retain scenario IDs and regression commands across stages. Record which earlier scenarios were
rerun and which evidence was reused, with the reason. Added behavior or an affected dependency
requires renewed relevant checks; an unrelated edit does not invalidate the entire suite.

Use pass/fail/unverified for scenario verdicts, not as new registry status values. A development
card's done status remains completion of its own accepted scope. The corresponding milestone
becomes verified only after its verification card passes and completes under integration policy.

When reporting queue health, count implemented milestones awaiting verification and their
blocking defects. Under an authorized queue, prefer unblocking failed or waiting stages before
adding dependent features. Any numeric work-in-progress limit comes from project policy; the
skill does not impose a global stop on independent work.
