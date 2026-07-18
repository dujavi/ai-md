# ai-md

Public **AXI-shaped** CLI for a **private** personal AI config directory (`~/.ai-md`).

| Layer | Path | Purpose |
|-------|------|---------|
| **System** | `skills/`, `rules/` | Global base — linked to `~/.cursor/{skills,rules}` |
| **Templates** | `templates/<type>/` | Project-type starters (`base`, later `forms`, …) |
| **Projects** | `projects/<name>/` | Per-app overlays (repo `.cursor` → here) |

No personal content ships in this package. Reads default to TOON + `help[]` (`--json` available).

## Install

```bash
npm i -g @dujavi/ai-md
```

## Layout idea

```text
~/.ai-md/
  skills/                 # system — all agents see these
  rules/
  templates/
    base/                 # default project starter (customizable stubs only)
    # forms/ …            # other use cases
  projects/
    presenter/
    sendfolio/
```

Put shared agentic skills/rules in **system** folders. Put only type-specific or per-project starters under **templates/**.

## Commands

```bash
ai-md                                      # status
ai-md init-project --repo ~/app --from base
ai-md apply-template --project app --from base
ai-md doctor --fix --agents cursor,claude
ai-md pull | push -m "why"
ai-md ensure-tools
```

## Environment

- `AI_MD_DIR` → `~/.ai-md`
- `AI_MD_REMOTE` → private content git URL
