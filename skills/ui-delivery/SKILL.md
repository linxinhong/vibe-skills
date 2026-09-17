---
name: ui-delivery
description: >
  Design and deliver business Web UI through a visible interaction proposal, project-specific
  patterns, and task-based browser acceptance. Use for new business page flows, substantial
  layout changes, or improving UI usability; minor copy or spacing edits use the lightweight path.
---

# UI Delivery

Make the intended experience visible before substantial implementation. Work on one user task
across its relevant pages; scale investigation to that task and its immediate upstream/downstream.

## Task display names

In task descriptions, proposals, progress updates, tables, review requests, acceptance reports,
and handoffs, use `任务名称（TASK-ID）`, for example `合同管理人工业务 Web（TASK-190）`,
rather than a bare ID. Resolve the title from the authoritative card; if unavailable, say
`名称待核实（TASK-ID）` instead of inventing one. Work without a card uses its descriptive name
without a fabricated ID. Keep raw IDs in commands, artifact paths, branches, and structured fields;
this is a display rule, not a schema change. Carry the name/ID mapping and this rule into any
delegated task brief.

## Project configuration

Start at `.tasks/README.md` for the project's history, product map and current delivery context.
When creating or maintaining that entry, follow [Project context](references/project-context.md).
Update only facts affected by authorized work; audit-only requests report stale context without editing it.

Read repository instructions and any declared UI configuration. Otherwise look for
`.tasks/ui.yaml`. Use [assets/ui.yaml](assets/ui.yaml) as the starter when project setup is
authorized; resolve paths relative to the repository root. Keep an established equivalent
configuration instead of introducing a second one. Missing configuration does not block work:
infer routine defaults from the repository and state them briefly.

Read [references/config.md](references/config.md) when creating or interpreting the configuration.
It stores lasting preferences and source pointers, not business state machines, permissions,
task status, executable commands, or a page-generation language. Null and empty lists mean
unknown/unconfigured, not a discovered project fact. Follow task-relevant source pointers only.

Keep project UI data under `.tasks`: configuration at `.tasks/ui.yaml`, and preview/evidence
artifacts under `.tasks/ui/<task-id>/` (use a short task slug when no card exists). Reuse existing
task/design records for the proposal, decision and conclusion, linking the artifacts there.
If no such record exists, keep a short `.tasks/ui/<task-slug>/proposal.md` alongside the draft.
An explicit project path convention takes precedence. Keep only sanitized, useful evidence;
browser credentials, storage state and sensitive raw traces do not belong in tracked artifacts.

## Discover and propose

Identify the actor, intended outcome, relevant objects, route entry/exit, existing API/state/permission
contracts, and affected neighboring flows. Distinguish intended behavior, observed implementation,
and gaps. Resolve ordinary layout choices from approved patterns and project evidence. Surface
only unresolved choices that change the business outcome or scope.

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

Before substantial implementation, show a compact proposal in the user's language:

- The task and concrete page arrangement, including why a page, drawer, or dialog fits.
- The entry, primary action, state transition, result, failure recovery, and next destination.
- The affected routes/contracts and any assumptions without evidence.
- A GPT-generated design image before writing UI code for a new page or major layout change.
  Ground the image in the existing shell, tokens, representative content and proposed actions.
  Present the actual image with the operation flow and explain what the user is deciding.

For an existing application, default to editing a screenshot of its current page rather than
generating a standalone screen. Inspect a user-supplied screenshot or capture the relevant page
with `agent-browser` as the preferred capture tool, using the intended viewport and state.
For browser capture, read [Agent Browser](../agent-browser/SKILL.md), open the target application,
navigate to the relevant page and wait for the intended content/state to render. Save the screenshot
to the task's `images/before-vNNN` artifact before passing it as the actual reference image to
GPT image editing. Inspect the screenshot first; record the page URL, viewport and relevant state
without recording credentials. Reuse a suitable user-supplied screenshot when provided.
If agent-browser is unavailable, report the fallback and use another available browser capture
tool; do not silently replace the current-page capture with an invented screen.

Set the browser viewport before capture: use the project's requested target or default to
1440 × 900 CSS pixels. Capture the current viewport, not a full-page scrolling screenshot,
unless the task specifically concerns the whole page. Record viewport width/height, actual
image pixel width/height, scroll position and device pixel ratio when available in the prompt
record. Inspect actual dimensions rather than assuming CSS pixels equal image pixels; browser
device scale may differ. Reuse supplied screenshots at their actual ratio and label unknown
capture settings instead of attributing the default viewport to them.

Request the reference image's aspect ratio for generation using supported tool controls or
the prompt; do not invent unsupported size parameters. If the generator cannot match it,
preserve the reference scale with padding/letterboxing rather than stretching or cropping
meaningful UI. Inspect the returned image's actual dimensions and visual proportions; disclose
any remaining ratio/layout drift before review. A prompt requesting exact size is not proof
that the tool produced it. For a long-page task, prefer separate viewport/section references
over compressing a full-page screenshot into a landscape canvas.

For a content-only design, a cropped target region can be a separate reference: record its
pixel bounds in the original image and keep the original full viewport for context. Review
the generated region alongside the full screenshot, or use supported image editing to place
it back into that context; label composited previews and check scale/alignment. Follow the
image tool's editing rules for cropping, padding or compositing. In browser verification,
compare at the same target viewport, and check other relevant responsive sizes separately.
Generated pixels guide visual intent; actual browser layout determines implementation sizes.
Identify the blank or
replacement region and explain its boundary before generation; infer an obvious user-marked
region, asking only if competing interpretations would materially change the design.
Pass the actual screenshot as an image-edit reference to GPT image generation. Ask it to fill
only that region and preserve the surrounding navigation, page shell, typography, colors and
spacing. An annotation or mask may clarify the target where supported; do not assume the tool
supports masks. When replacing existing content, describe clearing that region in the edit
request instead of modifying production UI to obtain an empty screenshot.

Retain the original and generated version for comparison, recording viewport, page state and
target region in the proposal. Inspect whether generation changed surrounding elements and
correct meaningful drift or disclose it before review; preservation is a requested constraint,
not a guarantee of pixel-exact output. Use synthetic or sanitized page data for external image
processing, and keep credentials and sensitive records out of screenshot references.
If no current page exists, use an existing shell screenshot with a designated content region.
If no suitable screenshot is available, explain that limitation and agree on a standalone
design reference; do not present a generated shell as an actual current-page capture.

Persist image artifacts in the target project's `.tasks/ui/<task-id-or-slug>/images/`:
`before-v001.png` for the screenshot reference, `design-v001.png` for the generated edit,
and `prompt-v001.md` for its prompt, target region and reference paths. Increment the version
for a new iteration; reuse and reference an unchanged source screenshot. Preserve the actual
image format/extension rather than renaming non-PNG bytes to PNG. Copy tool-produced temporary
files into this directory before handing off; a temporary path or chat-only attachment is not
the saved project artifact. When local export is unavailable, state that the image is not yet
saved and give the actual returned artifact location without claiming persistence.
Link every delivered design using an absolute local file link in the response. Record the selected
image version in the existing proposal/decision record instead of an ambiguous `latest` filename.

For review, regenerate a single-file comparison page from the saved artifacts at any time with
this skill's zero-dependency script: `node <skill-dir>/bin/preview.mjs --task
.tasks/ui/<task-id-or-slug> --open`. It rebuilds `preview.html` and `preview.json` in the task
directory, embedding the reference screenshot, design versions and prompts with their actual
pixel sizes, and flags ratio mismatches instead of stretching images. For an ad-hoc comparison
without a task directory, pass images directly instead of `--task`; each image accepts a title,
version label and prompt file (`--img a.png --version v001 --title 方案A --prompt a.md ...`,
`--before` for the reference screenshot), and the same provisional-selection boundary applies.
The page is a static
viewer: it cannot write back, and selections made inside it are provisional markers, not
approval. Treat the decision as changed only when the user sends back the copied or downloaded
feedback and you record it as above. Because the page embeds the images, check they are
sanitized before sharing the file.

The viewer supports system/light/dark themes and starts with the feedback panel collapsed.
Proposal and prompt documents render a safe Markdown subset: headings, paragraphs, lists,
quotes, fenced code, pipe tables, emphasis and HTTP(S)/mailto links. Raw HTML remains inert;
embedded Markdown images do not fetch external assets. This is not a full CommonMark renderer.
Use the feedback panel's `@` image references to identify the exact version and source path;
keep these references intact when copying feedback into the task's decision record.
Displayed approval badges reflect recognized source records, not a new approval. When a
decision cannot be recognized, consult the linked proposal instead of treating a candidate
badge as evidence that no decision exists.
The viewer keeps keyboard use deliberately small to coexist with Vim-style browser extensions:
focus an image and press `Enter` to enlarge it; use arrow keys and `Escape` inside the lightbox;
use `Command/Ctrl+Enter` in the feedback textarea to copy feedback, and `Escape` in the expanded
feedback panel to collapse it. Do not add global letter-key shortcuts.

Prefer one recommended arrangement. Produce alternatives only for a consequential unresolved
tradeoff. Use the available GPT image-generation tool and its applicable skill instructions;
do not substitute image search for generation. Generate one readable key view first, with
additional views only when needed to explain a consequential state or page transition.
Store the image and prompt under `.tasks/ui/<task-id-or-slug>/` when the tool supports local
artifacts; otherwise link the returned artifact and state the storage limitation. Treat generated
labels as illustrative: precise actions, states and permissions remain in the written proposal.
If generation is unavailable, report the limitation and agree on a substitute before writing
dependent UI code. Do not silently skip this preview or present a wireframe as GPT output.

## Decide the review boundary

Default `review.mode: significant` requests user review for a new page pattern, major layout
change, or business flow change. For new pages/layouts, finish the design image and present it before requesting
that decision; continue independent investigation/checks while it is pending. Await the decision
before writing dependent UI code, including a coded prototype. Silence is not acceptance.
For flow-only changes with an unchanged accepted layout, a concrete operation-flow proposal
can be reviewed without generating a redundant image.

Reuse of an already accepted pattern and minor edits proceed after a brief specific update.
Do not ask for the same decision again. An explicit request to proceed automatically, an already
accepted design covering the change, or `review.mode: autonomous` permits implementation without
another review round; still show the proposal before substantial edits. `preview_only` requests
end at the draft regardless of project mode. User instructions override these defaults.

Keep the proposal and decision in the existing task/design document when one exists. Link the
artifact and identify its revision, chosen arrangement, and the actual user decision or explicit
autonomy instruction. Mark an autonomous choice as agent-selected, never user-approved. Revise
only decisions affected by a material change; do not silently substitute a different layout.

## Implement and demonstrate

Reuse the project's components, tokens and accepted page patterns. A draft may evolve directly
into implementation when appropriate; a separate throwaway prototype is optional. Keep fixtures
isolated from production behavior and bind transitions to existing backend contracts.

After the visual direction is accepted, implement a connected prototype or a narrow real flow.
The generated image establishes visual intent, not interaction correctness or new business scope.
Compare the rendered implementation with the accepted image and documented decisions; preserve
their information hierarchy while adapting to real content and responsive behavior. Show material
departures. Verify the connected flow in a browser; image acceptance is not final delivery acceptance.

For each changed critical action, verify actor/precondition, visible result, failure recovery,
and next step. Select relevant cases such as returned-list context, retained failed input,
duplicate submission, refresh persistence, permission rejection, or partial completion.
Run project-required checks; add automated coverage when it protects meaningful behavior.

Use the available browser tooling to operate the core journey, not merely capture a screenshot.
Prototype checks can establish layout and interaction with fixtures. Integrated delivery needs
real API and persistence evidence for the outcomes claimed; mock-only evidence cannot establish
those outcomes. If the environment prevents a required check, mark that acceptance unverified
and identify what is missing. Do not substitute a build pass for business acceptance.

Report the implemented arrangement, any material departure from the proposal, and compact evidence:
scenario, actor/precondition, actions, expected/observed result, fixture/real mode, tested revision,
and artifact/log location. Distinguish pass, fail, and unverified. Human review establishes business
fit; automated checks establish only their tested expectations.

## Connect existing roles

For a project's task-progress preview rather than a UI design comparison, use
Task Integrator's [generic project preview](../task-integrator/references/preview.md).
It provides read-only task, dependency, roadmap and Git views; retain this skill's preview
for design images and decisions.

- [Business Verifier](../business-verifier/SKILL.md): for staged or full business acceptance,
  provide the approved proposal/decision, actor journeys, entry routes, real API/data setup,
  recovery expectations and browser evidence. Reference these from the verification card rather
  than duplicating them. Reuse valid browser checks; test changed combinations and uncovered
  scenarios. UI delivery retains its own browser acceptance, while the verifier checks the
  integrated business outcome. Verifying an accepted UI alone does not reopen visual design.
- [Architect](../architect/SKILL.md): use when boundaries or executable cards are needed. Attach
  the proposal and actor/action acceptance to existing cards; use its registry schema unchanged.
- [Coding Owner](../coding-owner/SKILL.md): use for owned card execution. Carry the proposal,
  recorded review decision, and acceptance into implementation; retain its ownership workflow.
- [Task Integrator](../task-integrator/SKILL.md): use for progress/evidence audits or authorized
  integration. Compare delivered behavior to the linked proposal and check evidence scope.

Read a linked role only when its work is needed. These links do not require three serial skill
passes, create new registries, authorize delegation, or grant merge/push authority. On handoff,
pass paths to the configuration, task/proposal, decision, and evidence; preserve one authoritative
record of each. For ordinary edits without cards, complete directly using the lightweight path.
