# Worktree acceleration

Use after normal ownership/claim and worktree creation; this helper does not replace task tooling.
Requires Python 3.9+ and Git; Go/pnpm are optional. Preparation itself needs no ZG. Preparation probes installed
tools; fix a broken installed tool rather than silently claiming its cache works. Toolchain selection
must already match the repository. Preparation persists the selected tool directories in private
worktree configuration so later helper calls use the same PATH; it changes no shell profile,
repository configuration, or index.

Select the repository-compatible tools, run `prepare`, then use `doctor` from the intended package cwd with the repository's
own toolchain check. It resolves required executables in the current command environment, returns
the native check's failure code, and performs no installs. For this repository, an example is:

```sh
python3 ~/.agents/skills/coding-owner/scripts/worktree-kit.py --root /absolute/worktree doctor --cwd web --require pnpm --require python -- node ../scripts/web-test-runner.mjs --check
```

Choose requirements from the scripts actually being run; retrieval follows SKILL.md, not toolchain checks. `python3` being installed
does not satisfy a script that invokes `python`. Select the repository-approved interpreter/toolchain
and run prepare plus doctor again after intentionally changing PATH. `run --require python` can guard
a nested script dependency before the command starts. A launcher such as `sh -c` hides its child
commands, so declare each child executable with `--require`. Grouped checks use `&&` or fail-fast shell
settings; otherwise run them separately so the final exit code cannot hide an earlier failure.
Use the relevant package directory for pnpm cache-source, since workspace-root probing may fail.

```sh
python3 ~/.agents/skills/coding-owner/scripts/worktree-kit.py --root /absolute/worktree prepare --cache-source /absolute/main
python3 ~/.agents/skills/coding-owner/scripts/worktree-kit.py --root /absolute/worktree run --label focused-test -- go test ./owning/package/...
# For pnpm choose the matching package directory as cache-source during prepare.
python3 ~/.agents/skills/coding-owner/scripts/worktree-kit.py --root /absolute/worktree prepare --cache-source /absolute/main/web
python3 ~/.agents/skills/coding-owner/scripts/worktree-kit.py --root /absolute/worktree install --cwd web --label dependency-setup
python3 ~/.agents/skills/coding-owner/scripts/worktree-kit.py --root /absolute/worktree report
```

Preparation reuses Go's resolved GOCACHE/GOMODCACHE and pnpm's resolved store, including existing
overrides. Run/install applies those Go paths; install explicitly selects the pnpm store with a
frozen lockfile. It does not share node_modules or dist, disable lifecycle checks, or automatically
install dependencies. Existing configured shared output directories still require inspection.
Preparation tests GOCACHE with a temporary write under the current permissions. If it fails, it
selects `<private-git-dir>/coding-owner/cache/go-build` and records `cache_decisions.GOCACHE` in
`environment.json`; existing cache contents remain intact. A fallback failure stops preparation.
The private fallback can be cold and does not prove a speedup. GOMODCACHE is retained so already
downloaded modules remain reusable; if a required download is denied, select a permitted module
cache explicitly and prepare again. Toolchain version compatibility still needs the repository check.
Run all later gates through `run`, including scripts that indirectly invoke Go, to retain this setup.
The per-worktree Git directory holds private runtime/log/measurement files outside the tracked tree.
`CODING_OWNER_RUNTIME_DIR` is available to commands; apps must explicitly use it. Ports/databases
must still be allocated with repository tooling; the helper does not pretend a suggested port is reserved.

Each run actually executes, bounds execution with `--timeout` (seconds, default 600), records elapsed
command time, tool versions, revision/dirty fingerprint, and output bytes. Successful output stays in
the private log; failures show the last 4 KB. Read the full log when acceptance needs assertions or
diagnostic detail. Use only nonsecret arguments: commands and output are stored locally. Never commit
raw logs or put credentials in arguments. Summaries reduce tool output, not measured model token usage.
No automatic skipping of tests: fingerprints omit ignored data, external state, and most environment.

Review after focused checks and before the final broad pass. Repeat broad gates only for relevant
changes, failures, or unresolved concerns, while retaining mandatory checks. A failure count includes
environment and test failures, so it is not a defect or rework count. The report's summed command
durations may overlap across parallel runs; they are not total task duration. Byte counts describe
saved logs, not net context/token savings. Go output marked `(cached)` may reuse test results;
use `-count=1` when measuring compilation reuse with actual test execution. Fast execution alone
does not prove a cache hit, and an existing installed dependency tree does not measure install savings.

For interruptions, maintain the repository's existing concise handoff JSON, then checkpoint it:

```sh
python3 ~/.agents/skills/coding-owner/scripts/worktree-kit.py --root /absolute/worktree checkpoint --brief /absolute/handoff.json
python3 ~/.agents/skills/coding-owner/scripts/worktree-kit.py --root /absolute/worktree resume
```

The brief contains `task` (name and ID), `entry_paths`, `decisions`, `remaining`, and `next_command`;
include evidence paths as needed. The helper caches this brief with branch/revision, not another task
registry. Resume flags changes including dirty file contents; check current ownership before work.
For retrieval and any ZG fallback, follow SKILL.md's workspace retrieval rule and preserve the
query/useful paths or concrete fallback reason in this existing handoff.

For timing comparisons, hold revision, command, toolchain, and acceptance constant; run multiple
trials and separate install/build/retrieval/test phases. Use newly allocated disposable caches for
cold trials, never clear the user's existing cache. Warm-cache speedup is not whole-task speedup.
Measure wrapper/setup overhead separately; do not derive token counts from bytes or promise a fixed gain.
