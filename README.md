# ai-md

Public **AXI-shaped** CLI for a **private** personal AI config directory (`~/.ai-md`): global skills/rules, per-project templates, and agent tool bootstrap.

| Layer | What | Where |
|-------|------|--------|
| **Public** | This package (`@dujavi/ai-md`) | npm + [github.com/dujavi/ai-md](https://github.com/dujavi/ai-md) |
| **Private** | Your skills, rules, `projects/` | `~/.ai-md` git repo |

No personal rules or skills ship in this package. Output defaults to [TOON](https://toonformat.dev/) with `help[]` next steps (`--json` available).

## Install

```bash
npm i -g @dujavi/ai-md
# binary: ai-md
```

## New machine

```bash
export AI_MD_REMOTE=https://github.com/<you>/.ai-md.git
ai-md install
ai-md ensure-tools
```

Optional multi-agent skill links:

```bash
ai-md install --agents cursor,claude,agents
```

## Day-to-day

```bash
ai-md                    # status (content-first)
ai-md status --json
ai-md pull
ai-md push -m "why"
ai-md doctor --fix
```

## Projects (templating)

```bash
# Seed from projects/template + link repo/.cursor + gitignore
ai-md init-project --repo ~/my-app

# Merge missing baseline files into an existing project
ai-md apply-template --project my-app

# Link only (empty rules/skills dirs if missing)
ai-md link-project --repo ~/my-app
```

## AXI-shaped reads

| Flag | Effect |
|------|--------|
| (default) | TOON on stdout + `help[]` |
| `--json` | Normalized JSON |
| `--full` | Paths + template drift details |

Mutations (`push`, `ensure-tools`) stay human/git-oriented.

## Environment

- `AI_MD_DIR` → `~/.ai-md`
- `AI_MD_REMOTE` → `https://github.com/dujavi/.ai-md.git`
