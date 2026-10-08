# Team setup: tools, agent skills and workflow

Onboarding guide for the three Poke Monopoly members. It covers what to install, how to set up your clone, and how a change goes from issue to merged PR. The development rules it supports are in spec v1.0 §7 (development harness) and §9 (control).

**Checked against upstream docs and each tool's `--help` on 2026-10-07.** Versions checked:

| Item | Version |
|---|---|
| gh-axi | 0.1.35 |
| chrome-devtools-axi | 0.1.39 |
| lavish-axi | 0.1.83 |
| quota-axi | 0.1.58 |
| tasks-axi | 0.2.6 |
| no-mistakes | v1.84.0 (the latest stable release on that date) |
| treehouse | v3.1.2 (latest release) |
| firstmate | `main` at `47aff86` (it has no version numbers) |
| GitHub CLI (`gh`) | 2.102.0 |
| git | 2.55.0 |
| Claude Code / Codex CLI | 2.1.292 / 0.160.1 |
| `typesafe` Claude Code plugin | 0.5.7 |
| `impeccable` (npm installer) | 4.1.0 |

If your versions are newer and a command here fails, trust the tool's `--help` and tell the team so this page gets fixed.

## 1. Who does what

Every member works through their own coding agent and owns one stream.

| Stream | Member | Area | Agent setup |
|---|---|---|---|
| A | punkharb | Engine and sim | Own agent (Claude Code or Codex) |
| B | Mrmo0p | Jev and eval | Own agent (Claude Code or Codex) |
| C | AokDesu | Web UI and playtest | Works through firstmate |

The repository is private. `main` has a ruleset: every change goes through a PR with one teammate's approval, with no force-push and no deletion. Ask the repo owner for access first, then run `gh auth status` to confirm you can see it.

## 2. Prerequisites

Install these before the tools in §3.

| Requirement | Minimum | Who | Notes |
|---|---|---|---|
| git | any current release | everyone | Required by no-mistakes and treehouse. |
| GitHub CLI `gh` | any current release; **2.99.0** only for `--attach` on issues and PRs | everyone | Run `gh auth login`, then `gh auth status`. gh-axi, no-mistakes (PRs and CI) and firstmate all use it. |
| Node.js | **22.19 or newer** | everyone | The highest minimum among the tools: quota-axi needs 22.19, lavish-axi 22, chrome-devtools-axi 20, gh-axi 20, tasks-axi 20. The project itself uses Node 24 (`.node-version`; see the README); use that one for project work. |
| npm | the one shipped with Node | everyone | Used for `npm install -g` and `npx`. Set up a user-level prefix or a version manager (mise, nvm, fnm) so you never need `sudo`. |
| A coding agent | Claude Code or Codex at minimum | everyone | no-mistakes needs at least one runnable agent; `agent: auto` in `~/.no-mistakes/config.yaml` picks one it finds. |
| Chrome | stable channel | stream C; others if they check the UI | chrome-devtools-axi drives a local Chrome. Its default is the stable channel (`CHROME_DEVTOOLS_AXI_CHANNEL` selects another). |
| tmux | any current release | stream C (firstmate) | tmux is firstmate's default session backend. firstmate also supports other backends; see its docs if you prefer one. |
| `curl` | any | everyone | The no-mistakes and treehouse installers use it on macOS/Linux. |

You do **not** need Go, pnpm or a Rust toolchain. They appear in the upstream READMEs only for building from source.

### Platforms

- **macOS and Linux:** supported by every tool below.
- **Windows:** the READMEs for gh-axi, chrome-devtools-axi, lavish-axi, quota-axi, tasks-axi, no-mistakes and treehouse all list Windows as supported. no-mistakes and treehouse have PowerShell installers (shown in §3). The firstmate README does not list supported platforms, and its default backend (tmux) is a Unix tool, so a Windows member who wants firstmate should ask upstream before relying on it. None of the READMEs mention WSL; treat WSL as an untested option.
- **Apple Silicon and Intel macOS:** the no-mistakes Nix flake does not cover Intel macOS; use the install script there.

## 3. Required tools

All the `*-axi` CLIs print compact output designed for agents, and you can also run them yourself. The table gives the CLI install; the matching agent skills are in §4.

| Tool | What it is for in this project | Who needs it | Install | Verify |
|---|---|---|---|---|
| **gh-axi** | Read issues, open and review PRs, check CI, from you or your agent. | Everyone | `npm install -g gh-axi` | `gh-axi --version` |
| **no-mistakes** | The validation gate: review, tests, docs, lint, push, PR and CI before a change reaches `origin`. Spec §7 requires a validated PR. | Everyone | macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.sh \| sh`<br>Windows (PowerShell): `irm https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.ps1 \| iex` | `no-mistakes --version`, then `no-mistakes doctor` |
| **quota-axi** | Shows how much of your Claude/Codex quota is left, so you can decide how many agents to start. | Everyone | `npm install -g quota-axi` | `quota-axi --version` |
| **lavish-axi** | Lets your agent turn a plan, comparison or UI review into an HTML page you annotate and send back. | Everyone (heaviest use: stream C, design reviews) | `npm install -g lavish-axi` | `lavish-axi --version` |
| **chrome-devtools-axi** | Lets your agent open the running web app, click through it, read the console and take screenshots. | Stream C; anyone checking the UI | `npm install -g chrome-devtools-axi` | `chrome-devtools-axi --version` |
| **treehouse** | Hands each agent its own clean git worktree, so parallel agents never collide and never share your `.env`. firstmate uses it for every task. | Stream C (needed by firstmate); recommended for A and B whenever you run more than one agent | macOS/Linux: `curl -fsSL https://kunchenguid.github.io/treehouse/install.sh \| sh`<br>Windows (PowerShell): `irm https://kunchenguid.github.io/treehouse/install.ps1 \| iex` | `treehouse --version` |
| **firstmate** | An orchestrating agent: you talk to one "first mate" and it dispatches crewmates (each in its own treehouse worktree) and brings back PRs. | Stream C only (AokDesu) | `git clone https://github.com/kunchenguid/firstmate` (the cloned repo *is* the install), then start your agent inside it | Start `claude` in the clone; the first mate checks its toolchain and offers to install what is missing |
| **tasks-axi** | Backlog manager. firstmate uses it as its task queue. | Stream C (firstmate users). Optional for A and B: our backlog is GitHub issues. | `npm install -g tasks-axi` | `tasks-axi --version` |

The `npm install -g` commands are the "session hook" install route in each README. The READMEs' recommended route is the agent skill alone (§4), which fetches the CLI on demand through `npx -y`. We install both so the commands in this guide work in your own terminal too.

> **no-mistakes stays on stable releases.** The installer above installs the latest *stable* release. Never install a prerelease (`no-mistakes update --beta`). See §8.

### Optional: not needed for this project

| Tool | Why it is not needed here |
|---|---|
| `kunchenguid/kun` (`/kun`) | A general bundle of Kun's engineering skills and workflows. We use the specific tools above instead. |
| `kunchenguid/axi` skill | Design principles for people who *build* agent-facing CLIs. We only use such CLIs. |
| `gnhf` | Runs agents unattended overnight in a loop. Our work is PR-based and reviewed. |
| `backpass` | Trains an `AGENTS.md` from sessions. Our root `AGENTS.md` is owned by the spec and the repository-setup issue. |
| `vision` | Drafts a `VISION.md` from repo history. The spec is our vision document. |
| `acpx` | A headless client for Agent Client Protocol agents. no-mistakes only uses it for ACP-based runners such as Cursor or Devin, which we don't use. |
| `compact-adviser` | A hint to run `/compact`. Convenience only. |
| `terminal-axi`, `agent-browser-axi`, `rough-cut-axi` | No upstream description; not reviewed. `chrome-devtools-axi` already covers browser checks. |
| Everything else under `kunchenguid` | Forks of unrelated libraries, apps, benchmarks and personal projects. |

## 4. Agent skills to install

Skills teach your agent when and how to use each tool. Install them **globally** (`-g`) so nothing lands inside the repository: a project-level install would add `.claude/` or `.agents/` files to your clone that must never go into a feature PR (the repository git-ignores them; see `AGENTS.md`).

The installer for most skills is [`npx skills`](https://github.com/vercel-labs/skills). It writes Claude Code skills to `~/.claude/skills/` and Codex skills to `~/.agents/skills/`. Use `-a` to name the agents; add more `-a` flags for other agents. Restart your agent session afterwards so it sees the new skills.

### 4.1 The axi and lavish skills (everyone)

```sh
npx skills add kunchenguid/gh-axi --skill gh-axi -g -a claude-code -a codex
npx skills add kunchenguid/quota-axi --skill quota-axi -g -a claude-code -a codex
npx skills add kunchenguid/lavish-axi --skill lavish -g -a claude-code -a codex
npx skills add kunchenguid/chrome-devtools-axi --skill chrome-devtools-axi -g -a claude-code -a codex
# stream C only (firstmate's backlog):
npx skills add kunchenguid/tasks-axi --skill tasks-axi -g -a claude-code -a codex
```

Drop `-a ...` to be asked which agent to install for. The `gh-axi`, `chrome-devtools-axi`, `quota-axi` and `tasks-axi` skills are discovery stubs: you don't invoke them, your agent loads them when a task touches GitHub, a browser, quota or the backlog. The `lavish` skill can also be invoked directly: `/lavish ...` in Claude Code, `$lavish ...` in Codex.

Verify: `npx skills ls -g` lists them, or look for `~/.claude/skills/<name>` and `~/.agents/skills/<name>`.

### 4.2 The no-mistakes skill (everyone)

`no-mistakes init` installs the `/no-mistakes` skill at user level for you (into `~/.claude/skills/no-mistakes/` and `~/.agents/skills/no-mistakes/`), so there is no separate `npx skills` step. It happens the first time you run `init` in a repo (§5). In Claude Code you invoke it as `/no-mistakes`; Codex invokes skills with `$` instead of `/`, so use `$no-mistakes` there.

### 4.3 `typesafe-ai` (stream B; useful to A for the Jev boundary)

`typesafe-ai` is TypeSafe's official skill for designing Jev/System One workflows and reading their current docs. Upstream is [`typesafe-ai/skills`](https://github.com/typesafe-ai/skills).

Claude Code (a plugin; run in a normal terminal):

```sh
claude plugin marketplace add typesafe-ai/skills
claude plugin install typesafe@typesafe-ai
```

Verify with `claude plugin list`. Invoke it as `/typesafe:typesafe-ai`, or just describe a Jev task.

Codex and other agents (via skills.sh):

```sh
npx skills add typesafe-ai/skills --skill typesafe-ai -g -a codex
```

Upstream's installation guide (https://docs.typesafe.ai/agent-skill#installation) also has a prompt you can paste into an agent and a manual route. This skill does not need a Jev key to be installed. Do not give it one (§5.3).

### 4.4 `impeccable` (stream C; the UI work)

`impeccable` ([`pbakaus/impeccable`](https://github.com/pbakaus/impeccable)) is a design skill with commands such as `/impeccable audit`, `critique` and `polish`.

```sh
npx impeccable install --providers=claude,codex --scope=global --no-hooks
```

Then, inside your agent, run `/impeccable init` in Claude Code (`$impeccable init` in Codex) once to set up design context.

- `--scope=global` installs under `~/.claude` and `~/.agents`, and we checked that it writes nothing into the current project when combined with `--no-hooks`.
- Without those two flags the installer asks whether to install per-project and offers to add edit-time hook manifests (`.claude/…`, `.codex/hooks.json`) and an `.impeccable/` folder to the repo. The repository git-ignores `.claude/`, `.codex/` and `.impeccable/` (see `AGENTS.md`), so per-project hooks stay local to you.
- If you do install hooks, Codex requires you to open `/hooks` and approve them once.
- Claude Code can also use the plugin route: run `/plugin marketplace add pbakaus/impeccable` inside Claude Code, then install from `/plugin`.
- Refresh later with `npx impeccable update`.

### 4.5 Where other agents differ

- **Codex** reads skills from `~/.agents/skills/` and invokes them with `$name` instead of `/name`.
- **Other agents** (Cursor, OpenCode, Pi, Gemini CLI and others): the `npx skills` table in its README lists each agent's `-a` name and skills directory. `no-mistakes init` also installs its skill for any agent that reads `~/.agents/skills/` (it names Codex, OpenCode, Rovo Dev and Pi).
- **Hook-based setup is optional.** The gh-axi, chrome-devtools-axi, lavish-axi and tasks-axi READMEs describe a `setup hooks` command that adds a `SessionStart` hook for Claude Code, Codex and OpenCode, giving the agent live context at the start of each session. It is not needed for this guide.

## 5. One-time setup per clone

### 5.1 Clone

```sh
gh repo clone AokDesu/poke-monopoly
cd poke-monopoly
```

### 5.2 Set up the no-mistakes gate

Run inside the clone (it needs the `origin` remote that `gh repo clone` already created):

```sh
no-mistakes init
no-mistakes doctor
```

`init` creates a local gate repo, adds a `no-mistakes` git remote, starts the background daemon and installs the `/no-mistakes` skill. `origin` is unchanged. `doctor` must show git and gh as OK, at least one agent you actually use (for example `claude` or `codex`) and the daemon running. Rows for tools you don't use, such as `az`, may show a dash; that is fine.

The repository's `.gitignore` already keeps `.env` and local tool folders such as `.lavish/` out of git.

### 5.3 The Jev key: `.env`, and keeping it away from agents

The team's Jev API key (`TYPESAFE_API_KEY`) is for the **server only** (spec §6 and §9). It must never be committed, pasted into an agent prompt, an issue or a PR, or be reachable from an agent's sandbox. Ask the stream B owner for it directly (a password manager or a private message, never an issue).

Create `.env` by typing the key at a hidden prompt, so it never appears in your shell history or on screen:

```sh
printf 'Jev key: '; stty -echo; IFS= read -r JEV_KEY; stty echo; echo
printf 'TYPESAFE_API_KEY=%s\nJEV_ENABLED=true\n' "$JEV_KEY" > .env
unset JEV_KEY
chmod 600 .env
git check-ignore -v .env      # must print a .gitignore rule; if it prints nothing, update from main before continuing
```

These commands work in bash and zsh (macOS default) on macOS, Linux and WSL. On native Windows, create `.env` in an editor instead of pasting the key into a terminal, and don't add a trailing space or quotes to the value.

`JEV_ENABLED=false` is the kill switch from spec §9: every AI falls back to the policy.

How the key stays out of agent reach. Be realistic: your agent runs as your user, and unless you run it inside a container or VM, it can read any file you can.

1. **Agents work in their own worktrees, not in the directory that holds `.env`.** Keep the clone with `.env` for *you* (running the web app and live Jev evals yourself). Run agents from a separate worktree. A gitignored file is not copied into a new worktree, so the `.env` stays behind. Get a worktree with `treehouse get -b <branch>` or `git worktree add ../poke-monopoly-wt -b <branch>`; firstmate does this automatically.
2. **Never list `.env` in a `.worktreeinclude`.** treehouse copies the gitignored files named in a committed `.worktreeinclude` from the main checkout into every worktree it hands out. Listing `.env` there would put the key into every agent's worktree.
3. **Agent sessions run with Jev off.** Spec §7 gives agents the offline loops: `npm test`, `npm run sim -- --games 100 --seed <n>` and `npm run eval:jev -- --offline`. None needs the key. Live Jev evals are run by a human or by nightly CI (spec §7).
4. **Deny the agent reading it.** In Claude Code, add to your *user* settings (`~/.claude/settings.json`) so it applies to every project:
   ```json
   { "permissions": { "deny": ["Read(//**/.env)", "Read(//**/.env.*)"] } }
   ```
   A leading `//` makes the pattern filesystem-absolute, so it also covers a worktree agent reading `../poke-monopoly/.env`; a plain `./.env` rule would only match under the agent's own working directory. Per the [Claude Code permissions docs](https://code.claude.com/docs/en/permissions), Read deny rules cover the built-in file tools and the file commands Claude Code recognizes in Bash (`cat`, `head`, `tail`, `sed`), but not a command that reads files without naming them (for example `grep -r` from the directory that holds the file) or an arbitrary subprocess. So this is a safety net, not a boundary. Codex has no equivalent rule we verified; rely on points 1 to 3.
5. **no-mistakes pipeline agents get pushed commits, not your working files.** Each run builds a worktree from the pushed branch, so an untracked `.env` is not in it. Be aware that by default no-mistakes launches Codex with its sandbox bypassed (`--dangerously-bypass-approvals-and-sandbox`) and, when no intent is supplied, reads recent local Claude Code and Codex transcripts to infer it. So if the key is ever typed into a prompt, it is in a transcript.

If the key ever appears in a prompt, transcript, log, issue or PR, treat it as leaked: tell the team and rotate it.

## 6. The team workflow: one change, end to end

Worked example for stream A. The numbers and names are illustrative; replace them with yours.

### Step 1: pick your issue

```sh
gh-axi issue list --assignee @me --milestone "<milestone title>"
gh-axi issue view 12
```

Read the issue and the spec section it cites. If it cites none, ask before starting: spec §2 says every PR cites a spec section.

### Step 2: branch into its own worktree

From your main clone (the one holding `.env`), create the branch as a separate worktree so your agent never works in the directory with the key (§5.3):

```sh
git fetch origin
git worktree add ../poke-monopoly-a12 -b a/12-lap-credit origin/main
cd ../poke-monopoly-a12
```

`treehouse get -b a/12-lap-credit` does the same from the treehouse pool. Worktrees share the clone's remotes, so `git push no-mistakes` and `/no-mistakes` work from the new directory without another `init`.

Suggested branch name: `<stream letter>/<issue number>-<short-slug>`. (firstmate uses its own `fm/` prefix for crew branches.)

### Step 3: prompt your agent

Cite the issue **and** the spec section, and state the boundaries from spec §7 so the agent doesn't have to guess. Start the agent from the worktree you just created (§5.3).

```
Implement GitHub issue #12 (Lap credit on Start) per spec v1.0 §6 item 5
(routeProgress, creditedLap, "Position = ((routeProgress % 24) + 24) % 24").
Read the issue and that spec section first. House rules: engine/ has no IO,
numbers live only in the engine, no keys anywhere. Add tests for the invariants
in §8 that this touches (pushed/pulled movement gives no reward; re-crossing an
old milestone gives no reward). Run `npm test` until it passes. Do not edit the
spec; if the spec is wrong or ambiguous, stop and ask me.
```

A second example, for stream B:

```
Implement #31: the keep-or-sell Choice question per spec §5.3 and the state/question
rules in §5.4. Use the typesafe-ai skill for the question shapes, but work only from
offline fixtures: run `npm run eval:jev -- --offline`. There is no API key in this
environment and you must not look for one.
```

Run the loops yourself first (`npm test`, then `npm run sim -- --games 100 --seed 1`). Their script names come from spec §7.

### Step 4: validate through no-mistakes

Commit your work on the branch, then use whichever entry point you prefer:

- **Ask your agent to run the gate** (Claude Code: `/no-mistakes`; Codex: `$no-mistakes`). Put the spec section in the task text. The agent passes your text to no-mistakes as the *intent*, and no-mistakes includes the intent in the PR body by default:
  ```
  /no-mistakes Lap credit on Start for issue #12, spec v1.0 §6 item 5 and §8 invariants
  ```
  Bare `/no-mistakes` validates work you already committed.
- **Or push through the gate yourself:** `git push no-mistakes`, then run `no-mistakes` to watch and approve findings in the TUI.

The pipeline runs intent, rebase, review, test, document, lint, push, PR and CI. Safe fixes are applied for you; anything that needs a judgement call stops and asks. When every step is green it pushes your branch to `origin` and opens the PR. `no-mistakes runs` lists recent runs and `no-mistakes attach` reopens the TUI for the active one.

### Step 5: make sure the PR cites the spec section

Spec §7 requires it, and no-mistakes writes the PR body itself, so check:

```sh
gh-axi pr view 7 --full
```

If the body has no line like `Spec: v1.0 §6 item 5, §8`, add one. Copy the current body into a file, add the line, then:

```sh
gh-axi pr edit 7 --body-file pr-body.md
```

Check CI: `gh-axi pr checks 7`.

### Step 6: a teammate reviews and approves

The ruleset needs one approval from someone other than you. Ping the reviewer in the team chat. The reviewer:

```sh
gh-axi pr view 7 --full          # description and spec citation
gh-axi pr diff 7
gh-axi pr checks 7
gh-axi pr review 7 --approve --body "Matches §6 item 5; invariants covered."
# or: gh-axi pr review 7 --request-changes --body-file review.md
```

A good review checks the diff against the cited spec section, not only that tests pass.

### Step 7: merge

After approval and green checks:

```sh
gh-axi pr merge 7 --squash --delete-branch
```

Then clean up. In your main clone, update `main` and remove the worktree:

```sh
git switch main && git pull --ff-only
git worktree remove ../poke-monopoly-a12
```

Use whichever merge method the repository allows (`--merge`, `--squash` or `--rebase`); if one is rejected, try another. Never force-push to `main`: the ruleset blocks it.

If a rule or number changed, the spec and its tests must change in the same PR (spec §7).

## 7. Tool usage examples for this project

Each example shows what you type. Where the tool is driven by an agent, the prompt is shown.

### gh-axi: see your work

```sh
gh-axi                                    # dashboard: open issues and PRs
gh-axi issue list --assignee @me --milestone "<milestone title>"
gh-axi issue list --label "<label>" --state open
gh-axi issue view 12 --comments
gh-axi pr list --state open
```

Or to your agent: `Use gh-axi to list my open issues for the current milestone and tell me which spec sections they cite.`

### chrome-devtools-axi: check the web UI

Start the web app first (`npm run dev`; see the README), then:

```
Use chrome-devtools-axi to open <dev server URL>, start a 2-seat game, and check that the
board shows 24 spaces and the console has no errors. Take a screenshot at 390px width.
```

Under the hood the agent runs commands like these, which you can also run:

```sh
chrome-devtools-axi open <dev server URL>
chrome-devtools-axi snapshot             # accessibility tree with @refs
chrome-devtools-axi click @<ref>
chrome-devtools-axi resize 390 844
chrome-devtools-axi screenshot ./board-mobile.png
chrome-devtools-axi console              # console messages
chrome-devtools-axi stop                 # stop the background browser bridge
```

Keep screenshots out of commits unless the PR is about them. Never point the browser at a page showing the Jev key.

### lavish-axi: review a plan or UI visually

```
/lavish lay out the screen flow in spec §3 as one page with a card per screen,
plus screenshots of what the web app shows today. I'll annotate what is unclear.
```

(In Codex, use `$lavish`.) Your agent writes an HTML file under `.lavish/`, runs `lavish-axi .lavish/<file>.html` to open it in your browser, and then `lavish-axi poll` to wait for your annotations. Select an element or text, add a note, and send it. Lavish runs locally; `.lavish/` is git-ignored.

Do **not** run `lavish-axi share` for this project. It publishes the page to the third-party ht-ml.app service, public by default, and the repository is private.

### quota-axi: check quota before starting several agents

```sh
quota-axi --provider claude,codex
```

Read `effectivePercentRemaining` and `runway`. In the `exhaustion` block, `usableRunwaySeconds` is the time until that window is projected to run out. If runway is short, start fewer agents or wait for the reset. `quota-axi --tui` gives a live view. It reads local credentials on your machine and only calls each vendor's own quota endpoints.

Or to your agent: `Check quota with quota-axi first. If Claude has under an hour of runway, don't start more than one task.`

### no-mistakes: the gate

```sh
no-mistakes                    # open the TUI for the active run
no-mistakes runs               # recent runs for this repo
no-mistakes doctor             # system and agent health
```

### firstmate and treehouse (stream C)

Install firstmate once, anywhere outside the project clone, then start your agent in it:

```sh
git clone https://github.com/kunchenguid/firstmate
cd firstmate
claude
```

Then talk to the first mate. A projects folder inside firstmate holds the clones it works on, and an unregistered project defaults to shipping through no-mistakes, which is what we want:

```
ahoy! Register https://github.com/AokDesu/poke-monopoly as a project that ships through
no-mistakes. Then dispatch issues #14 and #15 as two parallel tasks. Each PR must cite the
spec section named in its issue (spec v1.0 §3.1 for UI behaviour). Never put a Jev key
anywhere. Tell me when the PRs are ready for my review.
```

Each task runs in a clean treehouse worktree. You can watch them from the pool:

```sh
treehouse status               # all pooled worktrees and whether each is in use
```

firstmate returns worktrees to the pool for you. Don't return or remove one yourself while a crewmate may be using it. Before dispatching several tasks, run `quota-axi` (above). When a PR is ready, a teammate reviews and approves it as in §6; then tell the first mate to merge it.

### tasks-axi (stream C, through firstmate)

firstmate keeps its queue with tasks-axi. You can look yourself:

```sh
tasks-axi            # dashboard of the current backlog
tasks-axi ready      # only unblocked work
```

## 8. Troubleshooting

### no-mistakes runs stable releases only

Never install a prerelease: do not run `no-mistakes update --beta`. As of 2026-10-07 the latest stable release is v1.84.0, and every release newer than that (up to v1.89.0) is marked prerelease on GitHub. `no-mistakes update` with no flag installs the latest stable release, and the install script resolves GitHub's `/releases/latest`, which also skips prereleases. If you already installed a beta, reinstall stable by re-running the install script from §3, then `no-mistakes daemon restart`.

### `no-mistakes update` does not refresh the installed skill

`update` replaces the binary and restarts the daemon, but it never rewrites `/no-mistakes` in `~/.claude/skills/` or `~/.agents/skills/` (there is no skill code in its update path). After every update, re-run:

```sh
no-mistakes init
```

in any initialized repo. Re-running is safe: it refreshes the gate wiring and overwrites a stale `SKILL.md` from an older binary. Restart your agent session afterwards.

### A global `rerere.enabled` breaks no-mistakes rebases

Symptom: a pipeline rebase step stops on a conflict that you already resolved once; the file shows **no** conflict markers, but `git rebase --continue` says `needs merge` / "You must edit all merge conflicts and then mark them as resolved using git add".

Cause: with `git config --global rerere.enabled true`, git replays a recorded resolution into the working tree but leaves the file unmerged in the index. Tools and agents that look for conflict markers see a clean file.

Fix: turn rerere off in the gate repo only (not in your global config):

```sh
git -C "$(git remote get-url no-mistakes)" config --local rerere.enabled false
```

`git remote get-url no-mistakes` prints the gate repo's path (it is also shown by `no-mistakes init`). This one is **not in upstream's docs**; we reproduced the behaviour with plain git 2.55.0 on 2026-10-07 and confirmed the fix, but we did not run a full no-mistakes pipeline against it.

### Other problems you may hit

| Symptom | Fix |
|---|---|
| `no-mistakes doctor` shows no usable agent | Install and log in to Claude Code or Codex, then re-run `doctor`. To force one, set `agent: claude` or `agent: codex` in `~/.no-mistakes/config.yaml`. |
| You pushed with `git push origin` | That bypasses the gate. Push to the `no-mistakes` remote, or use `/no-mistakes`. |
| Skill doesn't show up in your agent | Restart the agent session. Confirm with `npx skills ls -g` that it was installed globally; `-g` was needed. For quota-axi the README notes `-g` may print a warning for some agents even when the install worked, so check the skills directory. |
| `npm install -g` fails with `EACCES` | Don't use `sudo`. Use a Node version manager or an npm user prefix. |
| `quota-axi` or `lavish-axi` refuses to run | Check `node --version`; you need Node 22.19 or newer. |
| `chrome-devtools-axi` hangs or reports a dead browser | Run `chrome-devtools-axi stop`, then open the page again. It restarts a bridge whose browser has died. |
| `gh-axi` says a command needs a newer `gh` | Only `--attach` needs `gh` 2.99.0 or newer. Upgrade `gh`. |
| `treehouse` can't reuse a worktree | It only reuses clean, idle slots. See `treehouse status`; ask before removing anything another agent might be using. |

## 9. Keeping this page current

The commands here come from upstream READMEs and `--help`. When a tool changes, update this page in a PR that cites the upstream source, bump the versions table at the top and change the checked date. If you add a team convention (branch names, labels, merge method), add it to §6.
