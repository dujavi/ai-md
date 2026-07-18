# ai-md

Public CLI for syncing a **private** personal AI config directory (`~/.ai-md`) and installing agent CLIs.

| Layer | What | Where |
|-------|------|--------|
| **Public** | This package (`ai-md`) — sync/link/ensure-tools scripts only | npm + [github.com/dujavi/ai-md](https://github.com/dujavi/ai-md) |
| **Private** | Your skills, rules, projects | `~/.ai-md` git repo (e.g. `github.com/<you>/.ai-md`) |

No personal rules or skills ship in this package.

## Install

```bash
npm i -g @dujavi/ai-md
# or one-shot:
npx @dujavi/ai-md --help
```

## New machine

```bash
npm i -g @dujavi/ai-md
export AI_MD_REMOTE=https://github.com/<you>/.ai-md.git   # your private content repo
ai-md install
ai-md ensure-tools   # grok + quota-axi
```

Defaults (override with env):

- `AI_MD_DIR` → `~/.ai-md`
- `AI_MD_REMOTE` → `https://github.com/dujavi/.ai-md.git`

## Commands

```bash
ai-md install
ai-md pull
ai-md push -m "why"
ai-md status
ai-md doctor --fix
ai-md ensure-tools          # alias: tools
ai-md link-project --repo ~/my-app
```

`install` / `pull` / `doctor` keep:

- `~/.cursor/skills` → `$AI_MD_DIR/skills`
- `~/.cursor/rules` → `$AI_MD_DIR/rules`

## Agent-friendly

Non-interactive flags only (`--dry-run`, `--force`, `--fix`, `-m`). No prompts. Prefer `npx -y @dujavi/ai-md <cmd>` when not installed globally.
