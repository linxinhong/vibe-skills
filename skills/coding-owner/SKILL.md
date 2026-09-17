---
name: coding-owner
description: >
  Execute an existing repository task card with exclusive ownership, scoped implementation,
  verification, and evidence-backed completion. Use for task-card execution or an authorized
  queue; ordinary edits without a task registry do not require this workflow.
metadata:
  version: "4.8"
  role: coding-owner
---

# Coding Owner

Own the requested outcome through the completion boundary authorized by the user.
Repository instructions and existing session authorization determine whether that boundary is a
verified branch, a PR, or integrated main. A skill invocation does not authorize an unrelated queue.

## Locate and claim

Start with `.tasks/README.md` when present. Keep affected product/page-map facts current using
[the shared .tasks convention](../ui-delivery/references/project-context.md) as part of delivery.

Read repository task routing, then obtain the selected card with this skill's read-only helper:

```sh
node <coding-owner-dir>/bin/get-task.mjs <ID> --root <authoritative-checkout>
```

It returns the complete target card and bounded direct-dependency excerpts, including available
interface pointers and evidence. Follow linked design/code paths only as needed. Query a dependency
by its ID for omitted fields or deeper context; summaries are not acceptance proof. Use `--registry`
for a non-default ledger and `--help` for output options. The helper supports JSON or YAML cards
starting with `- id:`; unsupported layouts need a compatible project reader or JSON export.
Default to this projection rather than loading all of tasks.yaml or running a full report for a
known ID. Use the repository's filtered task listing when selecting work. Resolve the authoritative
checkout before reading; the helper reads exactly the root supplied, without switching branches.
This helper only reads context; ownership and completion continue through the existing task tool.

Use the existing schema and task tool; do not create a competing registry. Choose within the
requested scope, favoring dependency-unblocking work when the user has delegated ordering.

For the bundled Node CLI, run from the target repository:

```sh
node ~/.agents/skills/task-integrator/bin/tasks.mjs claim <ID> \
  --registry <registry-path> --owner "<agent>#<unique-id>" \
  --branch <task-branch> --worktree <absolute-task-path>
```

An existing owned task should be resumed after checking ownership, not claimed again.
The claim tool locks and re-reads the registry, requires ready/unowned/completed dependencies,
and commits ownership to main. Create the task branch from that claim commit.
Omitting owner uses agent-process detection; supply a stable explicit owner if detection fails.

The bundled CLI currently targets main and a limited YAML schema. For other branch/schema
conventions use the repository's compatible tool; do not silently redirect state or bypass a
rejected claim. If no compatible ownership mechanism exists, resolve that concrete gap first.

Before claim/complete, inspect main's index: the CLI invokes git commit and could include
unrelated staged changes. Preserve those changes and coordinate the status write.

## Worktree location

For non-trivial work, concurrent work, or unrelated dirty changes, use:
`<main-repository-root>/.worktrees/<task-id>-<short-slug>`.

Resolve the authoritative checkout using git worktree list --porcelain. A task worktree or
current subdirectory is not the main root. Use the same absolute path for claim and worktree
creation; do not nest worktrees within another task's worktree or reuse another owner's path.
Explicit user/repository location instructions take precedence.

Before creation, ensure the main checkout's root .gitignore effectively ignores /.worktrees/.
Add and commit only the missing ignore rule as setup so task branches inherit it. Preserve
unrelated edits. Where a tracked ignore change is prohibited or cannot be isolated from another
owner's edits, use the local file resolved by git rev-parse --git-path info/exclude and report it
as local-only. Verify from the main root with:

```sh
git check-ignore -q -- .worktrees/<task-id>-<short-slug>/
```

Ignore rules do not untrack files. Preserve and report existing tracked worktree content.
Verify the task branch includes the claim commit and the worktree is exclusively owned.
A small, clean, single-owner change may use the main checkout if repository policy permits.

Reuse toolchain-supported dependency/download and content-addressed build caches when compatible
with the repository's toolchain and lockfile. Keep writable install trees, generated outputs,
runtime directories, ports, and test data isolated per worktree unless the tooling explicitly
supports concurrent sharing. Cache hits accelerate execution; they are not acceptance evidence.

After creating a worktree, read the [acceleration guide](references/worktree-acceleration.md),
run `prepare`, then `doctor` for the required tools and repository preflight before the first build.
On resume, check the saved environment and rerun preparation when tools or permissions changed.
Equivalent repository automation may replace the helper if it persists the selected toolchain/cache
paths and records command, revision, duration and exit status. Record which automation is used.
Use that runner for verification and scripts invoking build tools so repaired environment settings
survive subsequent commands. The helper probes GOCACHE writes and records a private fallback when
needed; it requires neither ZG nor dependency installation. If preparation fails, diagnose it before
the next expensive command. Select repository-compatible tool versions before preparing them.

## Bounded preflight

Start from the card's entry map and existing evidence rather than repeating a whole-repository
scout.

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

Batch independent searches/reads in one tool round; keep adaptive follow-ups sequential. Reuse
sufficient snippets. When a repeated hypothesis yields no new evidence, run a focused reproducer
or inspect the exact failing assertion and its inputs before another speculative edit.

Before implementation, establish the owner, public seam and affected callers, current behavior
versus target, relevant Spec/generated-file rules, and closest acceptance test. In particular,
check whether a declared contract also advertises a live provider before changing a Spec.
Run a cheap relevant baseline when it will distinguish existing failures from the proposed change.
Before expensive checks, run the repository's toolchain preflight from its required directory and
check the actual script interpreters/dependencies (for example, `python` is distinct from `python3`).
Use the helper's `doctor` with explicit required executables when repository tooling lacks that check.
For `sh -c` or another launcher, declare each nested executable with `--require`; the launcher alone
does not prove its children. Keep formatting, generation, and acceptance as separate helper runs, or
join grouped commands with `&&`/fail-fast shell settings so a later success cannot mask an earlier failure.
After an environment failure, repair the identified cause before retrying. Carry the working cwd,
toolchain selection, and runtime/port setup into the handoff; avoid copying transient PATH wrappers
as the only reproducible setup. Probe required runtime/Provider availability early and distinguish
unavailable-runtime evidence from successful model output or a failed Provider call.
Stop discovery once these are evidenced; expand scope only to answer a concrete remaining question.
The entry map limits initial reading, not correctness: inspect transitive consumers when affected.

## Implement and verify

For a stage verification or business acceptance card, read
[Business Verifier](../business-verifier/SKILL.md) and execute its verification workflow while
retaining this skill's ownership, environment and integration mechanics. For development cards,
identify the next linked verification milestone and hand off runnable entry points, resettable
data setup, relevant regression commands and known gaps. Complete the development card's own
acceptance; a separate stage verifier does not replace local tests or required review. Describe
development completion separately from business verification, and respect verification dependencies
when selecting subsequent work. Route verifier findings to scoped repairs with regression evidence.

For business Web UI cards, read [UI Delivery](../ui-delivery/SKILL.md) and the linked project
configuration/proposal. Follow its review boundary for unresolved new arrangements, reuse
recorded decisions, and attach task-based browser evidence to the existing completion record.
Keep ownership and integration mechanics here; UI delivery does not create a second registry.

Inspect the evidence needed for the task and choose the implementation locally. Keep the card's
outcome, boundaries, and acceptance; flag material contradictions between design and code.
A planned contract change is not itself an escalation. Escalate an unplanned boundary change or
an unresolved product decision that materially changes the requested result.

For multi-layer implementation, compile the public seam and domain skeleton as soon as buildable,
before expanding persistence and assembly. Complete one core behavior with a focused passing test,
then add adapters/persistence and their failure checks. If a layer cannot run independently, identify
the concrete dependency and use the smallest executable slice. Existing workflows may provide these
checkpoints; line counts and elapsed-time quotas do not substitute for behavioral feedback.
Format only the task-owned changed/new files; inspect staged paths before committing.
Select checks by changed behavior and risk, run repository-required gates, and record omissions honestly.

For cross-owner writes, test remote success followed by local failure, retry after restart, and a
competing cancellation/version change when supported. Assert both owners' resulting facts and
recovery state, not just local counters. Financial/concurrent operations need conservation and
idempotency assertions. A local transaction or race-detector pass alone does not prove these outcomes.

Run the closest behavioral check first, then affected-boundary gates, then broader suites required
by the changed risk or repository policy. Track commands, outcomes, tested revision (including
uncommitted changes), and relevant toolchain/environment. Reuse prior evidence only when its code,
dependencies, configuration, and environment remain applicable; rerun on uncertainty or a relevant
change. Required fresh release/live checks remain fresh. Avoid rerunning unchanged broad suites
merely to populate multiple handoff records.

Before completion, compare the diff with every acceptance scenario, not only the test list.
Before integrating cross-owner writes, money-affecting concurrency, or changes with a card-required
review, obtain an independent review of acceptance and failure recovery. This skill authorizes a
bounded read-only reviewer for those changes when delegation is available; give it the task name/ID,
tested revision, focused paths and failure scenarios. Other changes use review proportional to risk.
If independent review is unavailable or user instructions exclude delegation, disclose the local-only
review and unresolved coverage; do not represent it as independent approval. Preserve any mandatory
repository review requirement.

Schedule that review after the relevant implementation and focused tests are ready, before the
final broad verification pass. Give the reviewer the tested revision and acceptance gaps. Repair
findings with focused regression checks, then run the required final gates on the resulting code.
If a later change affects validated behavior, rerun the affected checks and renew relevant review;
an evidence-only commit does not by itself justify another full suite. Record why a repeat is needed.

When parallel agents are authorized, delegate bounded independent outputs with exclusive write
ownership, the shared contract, focused source pointers, and acceptance commands. Keep useful
local work; avoid duplicate discovery or concurrent edits to shared contracts. Return compact
diff/evidence summaries and coordinate the single main writer during integration.

Continue repairs while evidence supports a useful next step; there is no fixed retry quota.
Track meaningful attempts if the registry requires it. Stop for a concrete external blocker or
a decision outside scope, explaining the evidence and what would unblock progress.
Keep unrelated improvements as follow-up candidates, not new work in the active card.

At an interruption or ownership handoff, update the existing task evidence/handoff location with
branch/worktree, changed files, decisions, tested revision and checks, remaining failure, and next
command. Resume by checking ownership and the delta since that revision, not by restarting discovery.
When reporting efficiency, use available elapsed-time, retrieval-volume, test-time, and rework
measurements; distinguish estimates from measured comparisons. Token savings alone are not proof
of faster delivery or preserved quality.
Distinguish tests written, tests executed, and tests passed. Missing runner records mean unknown
execution until corroborated by session logs. Cache-read tokens are repeated processing, not fresh
input; report them separately. After a verified phase, checkpoint concise decisions, evidence and
remaining work when context is growing; use host-supported compaction/handoff if available. Keep
ownership and current task scope intact, and do not claim a new session erased context unless it did.

## Complete at the authorized boundary

When handing off a visual progress view, use Task Integrator's
[generic project preview](../task-integrator/references/preview.md) with the explicit project
root. Record branch/worktree and evidence in the existing card so the viewer can show them.
The preview is a read-only report and does not replace acceptance or completion mechanics.

When integration is in scope, perform it without another routine approval round:

1. Check current main, task ownership, and the task diff. Coordinate one main writer.
2. Integrate against current main using repository policy. Reverify when synchronization changes
   the tested result; retain valid evidence when the tested tree is unchanged.
3. Verify required acceptance and relevant regressions on the integrated result.
4. Persist completion and unlock dependencies with the task tool.

```sh
node ~/.agents/skills/task-integrator/bin/tasks.mjs preflight <ID> --registry <registry-path>
node ~/.agents/skills/task-integrator/bin/tasks.mjs complete <ID> \
  --registry <registry-path> --evidence-file <absolute-evidence-json>
```

The evidence file is a JSON array of records with type, check, status, and summary; include the
tested commit in the evidence. The CLI checks ancestry but does not run tests or establish that
evidence is truthful. That verification remains the owner's responsibility.

With this registry contract, done means merged to main, verified there, and recorded there.
A verified private branch is merge-ready (a report classification), not done.
If the requested boundary is a branch/PR, deliver it and leave integration-dependent status open.
Resolve conflicts when their intended result is clear; escalate ambiguous semantics rather than
overwriting other work. A handoff to Task Integrator does not expand merge authority.

Report the outcome, proving commit/branch, relevant checks, and any remaining blocker.
Continue to another card only within an already authorized queue; a risk label alone does not
require renewed approval. Do not push, deploy, or remove worktrees just because a card is complete.
