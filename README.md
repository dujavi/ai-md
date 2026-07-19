# @dujavi/ai-md

Public **AXI-shaped** CLI for a **private** personal AI config directory (`~/.ai-md`).

Build merges `shared/` + `agents/<harness>/` into `dist/<harness>/`, then links live tool dirs at dist. **Only installed AIs are linked** (detect dirs/binaries); use `--force-link` to override.

## Layout (private repo)

| Path | Role |
|------|------|
| `shared/{rules,skills}` | Cross-harness source |
| `agents/<id>/` | Harness-specific overlays (win on name conflict) |
| `dist/<id>/` | Generated (gitignored) — do not edit |
| `templates/<type>/` | Project starters |
| `projects/<name>/` | Per-app overlays (repo `.cursor` → here) |
| `scripts/` | Private machine scripts |

## Unique vs shared live roots

| Live root | Harnesses | Notes |
|-----------|-----------|--------|
| `~/.cursor/{skills,rules}` | **cursor** only | Unique |
| `~/.claude/{skills,rules}` | **claude** only | Unique |
| `~/.gemini/skills` | **gemini** only | Unique |
| `~/.config/opencode/skills` | **opencode** only | Unique |
| `~/.copilot/skills` | **copilot** (stub) | Unique |
| `~/.agents/skills` | **agents** (writer); **codex** is an **alias** | Shared — emit once |

Cursor / Gemini / OpenCode may *also read* `~/.agents/skills`; enabling `agents` feeds them without a second copy under those tools’ unique roots (unless those harnesses are enabled too, which builds `shared/` into each unique dist).

## Quick start

```bash
npm i -g @dujavi/ai-md

# A) Existing private git repo (clone/sync first — never skeleton-before-sync)
ai-md setup --remote https://github.com/<you>/.ai-md.git

# B) No remote yet → local skeleton only
ai-md init

# C) Optional auto-detect: if `gh` (or git github.user) identifies you
#    AND github.com/<user>/.ai-md exists, init/setup use that remote.
#    There is no hardcoded default remote.

ai-md pull
# edit shared/ or agents/<id>/ only
ai-md build
ai-md push -m "why"
```

## Commands

| Command | Purpose |
|---------|---------|
| `init` / `seed-skeleton` | Scaffold / merge recommended base rules+skills |
| `build` | Emit `dist/` |
| `rescue` | Promote dirty dist → `agents/<id>/` |
| `install` / `pull` | Git + build + link **installed** harnesses |
| `doctor --fix` | Rebuild + repair links |
| `harness list\|show\|set\|enable\|disable` | Register or retarget any agent |
| `config set --link-mode symlink\|junction\|copy` | Platform link mode |

Flags: `--agents cursor,claude`, `--force-link`, `--force` (discard dirty dist), `--dry-run`, `--json`.

## Platforms

| OS | Default `linkMode` |
|----|-------------------|
| Linux / macOS / WSL | `symlink` |
| Windows | `junction` (fallback symlink → `copy`) |

Run `ai-md` in the **same** environment as the IDE/CLI (Windows Cursor → Windows Node). WSL home ≠ Windows `%USERPROFILE%`.

## Edit policy

Never edit live harness dirs or `dist/`. See seeded `shared/rules/edit-source-not-dist.mdc` and skill `ai-md-config`.
