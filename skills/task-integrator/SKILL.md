---
name: task-integrator
description: >
  Audit task-card progress, ownership, integration evidence, and claimable work across branches.
  Reconcile status or integrate completed work when requested or already authorized.
  A progress question is read-only; this skill does not implement unrelated features.
metadata:
  version: "4.4"
  role: task-integrator
---

# Task Integrator

Compare recorded delivery with repository evidence. Separate "registry says done" from
"verified integrated result" when they differ. Use the existing integration policy and schema.

## Task display names

In task descriptions, progress updates, tables, review requests, and handoffs, use
`任务名称（TASK-ID）`, for example `合同管理人工业务 Web（TASK-190）`, rather than a bare ID.
Resolve the title from the authoritative card; if unavailable, say `名称待核实（TASK-ID）`
instead of inventing one. Work without a card uses its descriptive name without a fabricated ID.
Keep raw IDs in commands, paths, branches, and structured registry fields; this is a display rule,
not a schema change. Carry the name/ID mapping and this rule into any delegated task brief.

## Scope and authority

Infer the requested mode from the current request and prior authorization:
- Audit: inspect and report progress, claimable cards, and discrepancies without mutations.
- Reconcile: correct evidence-backed task-state errors within the authorized scope.
- Integrate: land qualified task work, verify it, record completion, and unlock dependencies.

Continue authorized integration without repeatedly seeking approval. A Coding Owner handoff
does not grant new authority. Respect PR-only policies and preserve unrelated work.
Do not push, deploy, reassign ownership, or remove worktrees merely because integration is requested.

## Evidence and tools

Use `.tasks/README.md` to locate project context and follow
[the shared .tasks convention](../ui-delivery/references/project-context.md) when checking map or
decision drift. Audit mode reports discrepancies without rewriting project history.

Read repository task routing, the authoritative registry, and relevant card/design documents.
Read status from the integration checkout; do not treat a private worktree's ledger as authoritative.
Keep separate registries/work packages distinct in reports.

### Workspace retrieval: ZG first for relationships

Before discovery, follow repository routing and classify the question:

- Exact occurrence (known symbol/path/error): use `zvec_grep_rg` when exposed, otherwise
  scoped `rg`; read located ranges with `sed` or the file reader.
- Unknown location, concepts, architecture, callers, or cross-file flow: first discover and
  call the host's `zvec_grep_search` tool with the question and known anchors. A known
  symbol does not make a relationship question an exact lookup. Use exact search for follow-up.
- Existing sufficient evidence or a supplied file/line needs no ceremonial search.

Pass a daemon-visible absolute `root` for the checkout being investigated on every ZG call.
Use the tool's actual schema; read `freshness`/`background_refresh` from its result without
a status preflight. Reuse sufficient snippets; open files only for missing context.
If the tool is absent, use an already configured ZG CLI only through its documented interface.
If neither entry is available, the call fails, or results are irrelevant/insufficient, state the
specific reason and continue with bounded exact lookup and focused reads. Do not repeatedly
retry unchanged failures. Creating, rebuilding, dropping, or widening persistent indexes
requires explicit user authorization.
A narrow/stale index cannot prove repository-wide absence.

In the existing evidence/handoff, add one compact retrieval line: ZG query + useful paths,
or fallback reason + searched scope; exact-only work can say so. No new report file is needed.

Run the bundled CLI from the target repository (Node 18+, no external dependencies):

```sh
node ~/.agents/skills/task-integrator/bin/tasks.mjs report --md
node ~/.agents/skills/task-integrator/bin/tasks.mjs validate --registry <registry-path>
node ~/.agents/skills/task-integrator/bin/tasks.mjs preflight <ID> --registry <registry-path>
```

Use list/show for targeted inspection and ui only when a dashboard is useful.
Multiple registry matches require explicit --registry for mutations.
The CLI currently targets main and supports a limited YAML schema; do not assume support for
another integration branch or arbitrary YAML. Use compatible repository tooling in those cases.

Inspect relevant task branches/worktrees for ownership, dirty files, HEAD, ancestry, changed paths,
and acceptance evidence. Check graph validity, private-only/duplicate claims, and false completion.
Tool output assists the audit; it does not prove implementation correctness or actual test execution.

## Completion standard

For stage verification cards, use [Business Verifier](../business-verifier/SKILL.md) to assess
scenario coverage, defect retests and evidence validity. Report development completion, stage
verification and full business acceptance separately using existing card statuses. Inspect actual
verification dependency edges before reporting downstream work claimable. Required failed or
unverified scenarios keep the stage incomplete. A changed business dependency requires affected
evidence to be rechecked; report stale evidence in audit mode and reconcile only when authorized.
Include implemented milestones awaiting verification and blocking defects in relevant queue reports.

For business Web UI acceptance, read [UI Delivery](../ui-delivery/SKILL.md) and compare the
linked proposal/decision with delivered behavior and scenario evidence. Distinguish fixture
preview from real API/persistence checks and flag required unverified outcomes. In audit mode,
report gaps without creating designs or modifying the application.

A task is done only when the required outcomes exist on the integration branch, required acceptance
passes there, and the authoritative registry records evidence there.
A clean verified private branch is merge-ready, not done. This is a report label, not a new status.

Check the evidence actually matches the card and tested revision. Documented procedures, mock-only
checks, skipped acceptance, and claimed external approvals do not prove the corresponding runtime
behavior. Report the concrete gap instead of manufacturing proof or broadening the audit needlessly.

Claimable means ready, unowned, and every dependency truly done on the integration branch.
Keep dependents closed when upstream completion is invalid.
An old claim is an inspection signal, not proof that its owner abandoned it; do not auto-reclaim.

## Reconcile

Correct only authorized, evidence-backed errors and preserve required result fields.
Reverse premature downstream readiness when an upstream completion is invalid.
Use a repository mutation tool where one exists. The bundled CLI has claim and complete but
no general reconcile command: authorized corrections may require a narrow registry edit,
validation, and a scoped commit on main. Coordinate one status writer.
Do not invent timestamps, approvals, ownership decisions, or verification results.

## Integrate

Process tasks in dependency order with one main writer:

1. Check ownership, current main, task diff, and index. Preserve unknown dirty changes.
   The bundled claim/complete commands use git commit, so unrelated staged files must not be
   included accidentally. A preflight result is not an exclusive integration lock.
2. Synchronize/integrate with repository-native Git policy. Resolve conflicts where intended
   behavior is established; return ambiguous domain decisions to the responsible owner.
3. Run required acceptance and affected regressions on the integrated result. Reuse valid evidence
   only when the tested tree and relevant environment are unchanged.
4. Record verified completion with the mechanical tool:

```sh
node ~/.agents/skills/task-integrator/bin/tasks.mjs complete <ID> \
  --registry <registry-path> --evidence-file <absolute-evidence-json>
```

The JSON file is an array of records with type, check, status, and summary; identify the tested
commit. Complete checks branch ancestry, writes done/evidence, unlocks eligible dependencies,
and commits the registry. It does not execute tests or validate the truth of the evidence.
Do not call it until those checks pass.

If integrated verification fails, retain an incomplete status, report the failure, and repair
integration-owned issues within scope. Send business defects to the implementation owner when
that handoff is available; do not expand the work into unrelated feature development.
For protected branches, follow the required merge path and wait for observable merge evidence
before recording done.

## Report

Preserve optional `recommended_model` when reconciling cards. In visual task cards,
`in_progress` shows the recorded claimant Agent; every other status shows the
recommended model. Missing recommendation or owner stays explicitly unspecified;
do not infer actual execution models or rewrite ownership from recommendations.

For visual project progress, read [preview inputs and usage](references/preview.md) and run
`node <skill-dir>/bin/preview.mjs --root <project> --open`. Use `--live --open` for worktree
opening and paginated Git history. It supports the existing YAML registry or generic JSON,
with overview, Kanban, an expandable dependency mind-map and rendered architecture views. Registry state remains read-only;
completion counts are not business coverage. Other projects need no project-specific code.

Lead with verified progress and the next actionable result. Include relevant task IDs, branches,
proving commits, checks, discrepancies, and claimable work. Use a table only when it helps compare
multiple tasks. State whether you audited, reconciled, or integrated; no fixed report template is required.
