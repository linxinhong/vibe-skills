# Task memory

Coding Owner writes a compact, searchable handoff for each completed task in
`.tasks/memory/<ID>.md`, using the repository's memory convention/template when present.
An explicit repository location takes precedence. The registry remains authoritative for status
and delivery evidence; durable design decisions belong in the owning design document.

## Pickup

Read the selected card and relevant direct dependencies' memories before expanding discovery.
Known IDs, symbols, or errors use scoped exact search; conceptual questions follow the skill's
workspace retrieval routing, scoped to memory first when useful. Hidden `.tasks` paths need
`rg --hidden`. A missing memory is a reason for focused source lookup, not proof of missing code.

Compare recorded source revisions with current relevant files, including local changes and
untracked files. Reuse unchanged findings and inspect changed contracts/callers. Old test results
are reusable only under the existing evidence applicability rules. Stop discovery when the owner,
entry points, failure behavior, and required verification are established.

## Write before completion

Record only information that helps another agent act:

- Task name/ID, 3–8 searchable keywords, owners, record date, source and tested revisions.
- Public contract/assembly entry paths and symbols, delivered behavior, dependency pointers.
- Observed traps: trigger → cause → effective treatment; important decisions and rationale.
- Verification commands, environment setup, outcomes and persistent evidence links; gaps,
  unverified scenarios, rollback/recovery constraints, and next command when work remains.
- Conditions under which the findings need rechecking, or a replacement memory/design link.

Default to 20–50 lines. A trivial task may use 5–10 lines and say “no new reusable lesson” with
the changed entry and verification. Summarize reusable findings rather than transcripts, complete
logs, or copied specs. Never invent experiments or turn acceptance requirements into passed
results. Preserve uncertainty and separate historical validation from fresh checks.

Write the memory after implementation and verification, include it in the task's authorized
delivery, and ensure it is integrated before invoking `complete` on main. Add its path to the
existing completion evidence array. Record the implementation/test commit, not the memory's own
future commit hash. Evidence-only documentation does not require rerunning unchanged broad tests.
If the boundary is a verified branch or PR, save the memory there with remaining integration steps;
do not mark integrated completion. At interruption, update the same file with partial work and
the next action, clearly labeling unverified progress.

Check that the file exists, its paths/symbols are real, and conclusions match the actual evidence.
The current task CLI does not mechanically enforce memory presence; this is the Coding Owner's
completion obligation. Keep secrets, live identifiers and raw business data out of memory.

Historical tasks are backfilled when reused, from available code and evidence; label backfill
date and missing verification. Retain original version context when adding corrections. Avoid
requiring every agent to read the whole memory directory or maintain a second task-status table.
