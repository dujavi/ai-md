#!/usr/bin/env bash
# Link a repo's .cursor/ to ~/.ai-md/projects/<name>/ (project rules/skills).
set -euo pipefail

REPO_MD="${AI_MD_DIR:-${CURSOR_MD_DIR:-$HOME/.ai-md}}"
DRY_RUN=0
FORCE=0
NAME=""
TARGET=""

usage() {
  cat <<'EOF'
Usage: ai-md link-project --repo <path> [--name <id>] [options]

Point a repository's .cursor/ at ~/.ai-md/projects/<name>/ so project
rules and skills live in the private AI_MD_DIR repo (not committed to the app).

Options:
  --repo <path>   Repository root to link (required)
  --name <id>     Project id under projects/ (default: basename of --repo)
  --force         Replace an existing non-symlink .cursor/
  --dry-run       Print actions without changing anything
  -h, --help      Show this help

Examples:
  ai-md link-project --repo ~/presenter
  ai-md link-project --repo ~/code/app --name my-app
  ai-md link --repo . --force
  npx -y ai-md link-project --repo ~/presenter

After linking, add .cursor/ to the app repo's .gitignore.
EOF
}

log() { printf '%s\n' "$*"; }
err() { printf 'error: %s\n' "$*" >&2; }
run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "dry-run: $*"
  else
    "$@"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      TARGET="${2:?--repo requires a path}"
      shift 2
      ;;
    --name)
      NAME="${2:?--name requires a value}"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      err "unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  err "missing --repo <path>"
  err "  ai-md link-project --repo ~/presenter"
  exit 1
fi

if [[ ! -d "$TARGET" ]]; then
  err "not a directory: $TARGET"
  exit 1
fi

TARGET="$(cd "$TARGET" && pwd)"
if [[ -z "$NAME" ]]; then
  NAME="$(basename "$TARGET")"
fi

PROJECT_DIR="$REPO_MD/projects/$NAME"
LINK="$TARGET/.cursor"

if [[ ! -d "$REPO_MD/.git" ]]; then
  err "$REPO_MD is not a git repo; run ai-md install first"
  exit 1
fi

run mkdir -p "$PROJECT_DIR/rules" "$PROJECT_DIR/skills"

if [[ -L "$LINK" ]]; then
  current="$(readlink "$LINK")"
  if [[ "$current" == "$PROJECT_DIR" ]]; then
    log "ok: $LINK → $PROJECT_DIR"
  else
    log "repair: $LINK (was → $current)"
    run ln -sfn "$PROJECT_DIR" "$LINK"
  fi
elif [[ -e "$LINK" ]]; then
  if [[ "$FORCE" -ne 1 ]]; then
    err "$LINK exists and is not a symlink (use --force after backing up)"
    exit 1
  fi
  log "replace: $LINK (--force)"
  run rm -rf "$LINK"
  run ln -sfn "$PROJECT_DIR" "$LINK"
else
  run ln -sfn "$PROJECT_DIR" "$LINK"
  log "linked: $LINK → $PROJECT_DIR"
fi

gitignore="$TARGET/.gitignore"
if [[ -f "$gitignore" ]] && grep -qxF '.cursor/' "$gitignore" 2>/dev/null; then
  log "ok: .cursor/ already in .gitignore"
elif [[ -f "$gitignore" ]]; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "dry-run: append .cursor/ to $gitignore"
  else
    printf '\n# Personal Cursor config (symlink to ~/.ai-md)\n.cursor/\n' >>"$gitignore"
    log "appended .cursor/ to .gitignore"
  fi
else
  log "note: no .gitignore at $TARGET — add .cursor/ manually"
fi

log "Project config: $PROJECT_DIR"
log "  rules:  $(find "$PROJECT_DIR/rules" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')"
log "  skills: $(find "$PROJECT_DIR/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
