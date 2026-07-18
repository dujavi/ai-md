---
name: ai-md-config
description: >-
  Manage personal AI config in ~/.ai-md: shared vs agents layers, build/dist,
  harness registration, rescue dirty dist. Use when adding rules/skills, fixing
  links, or supporting a new AI tool.
---

# ai-md config playbook

## Layout

| Path | Role |
|------|------|
| `shared/rules`, `shared/skills` | All harnesses |
| `agents/<id>/rules`, `agents/<id>/skills` | One harness (overlay wins on name conflict) |
| `dist/<id>/` | Generated — never edit |
| `projects/<name>/` | Per-repo overlays (`.cursor` → here) |

## Commands

```bash
ai-md pull / push -m "why"
ai-md build [--agents cursor,claude] [--force]
ai-md rescue --agents cursor
ai-md harness list | show <id>
ai-md harness set <id> --skills ~/path [--rules ~/path] [--format mdc|md|skills-only]
ai-md harness enable|disable <id>
ai-md init | seed-skeleton
ai-md doctor --fix
```

## Add a rule or skill

1. Choose layer: `shared/` (all tools) vs `agents/<id>/` (one tool).
2. Write the file under that path (never under `dist/` or `~/.cursor/…`).
3. `ai-md build`
4. `ai-md push -m "…"` when ready.

## New harness

```bash
ai-md harness set my-tool --skills ~/.my-tool/skills --rules ~/.my-tool/rules --format md
# put tool-specific content in agents/my-tool/
ai-md build --agents my-tool
```

## Unique vs shared `.agents`

- Unique live roots: `cursor`, `claude`, `gemini`, `opencode`, `copilot`
- Shared `~/.agents/skills`: `agents` (canonical writer); `codex` is an alias (no second emit)
