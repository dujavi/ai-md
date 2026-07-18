# ai-md

Public **AXI-shaped** CLI for a **private** personal AI config directory (`~/.ai-md`).

| Layer | Path | Purpose |
|-------|------|---------|
| **System** | `skills/`, `rules/` | Global base — linked to `~/.cursor/{skills,rules}` |
| **Templates** | `templates/<type>/` | Project-type starters (`base`, later `forms`, …) |
| **Projects** | `projects/<name>/` | Per-app overlays (repo `.cursor` → here) |

No personal content ships in this package. Reads default to TOON + `help[]` (`--json` available).

## New machine

```bash
npm i -g @dujavi/ai-md
ai-md setup --remote https://github.com/<you>/.ai-md.git --tools
# persists ~/.config/ai-md/config.json then clones + links (+ optional grok/quota-axi)
```

Or step by step:

```bash
ai-md config set --remote https://github.com/<you>/.ai-md.git --dir ~/.ai-md
ai-md install
ai-md ensure-tools
```

Precedence: `--remote`/`--dir` flags > `AI_MD_*` env > `~/.config/ai-md/config.json` > defaults.

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

- `AI_MD_DIR` / `AI_MD_REMOTE` — override for one shot (also set by the CLI after reading config)
- `AI_MD_CONFIG` — path to machine config JSON (default `~/.config/ai-md/config.json`)
