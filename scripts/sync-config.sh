#!/usr/bin/env bash
# Sync global personal Cursor skills/rules via ~/.ai-md (git + symlinks).
# Invoked by the public `ai-md` npm package. Private content stays in AI_MD_DIR.
set -euo pipefail

REPO="${AI_MD_DIR:-${CURSOR_MD_DIR:-$HOME/.ai-md}}"
REMOTE_URL="${AI_MD_REMOTE:-${CURSOR_MD_REMOTE:-https://github.com/dujavi/.ai-md.git}}"
DRY_RUN=0
FORCE=0
COMMIT_MSG="Update personal AI skills/rules"

usage() {
  cat <<'EOF'
Usage: ai-md <command> [options]

Sync private ~/.ai-md skills and rules (git). Tooling-only package — no personal content.

Commands:
  install   Create/repair ~/.cursor/{skills,rules} symlinks into AI_MD_DIR
  pull      git pull, then refresh symlinks (run before editing)
  push      Commit dirty changes and git push (run after editing)
  status    Show repo state, symlink health, and rule/skill counts
  doctor    Diagnose problems; with --fix, repair symlinks

Also: ai-md ensure-tools  (grok + quota-axi)

Options:
  -m, --message <msg>  Commit message for push (default: generic update)
  --dry-run            Print actions without changing anything
  --force              Replace existing non-symlink paths (install/doctor --fix)
  -h, --help           Show this help

Environment:
  AI_MD_DIR     Private config path (default: ~/.ai-md)
  AI_MD_REMOTE  Clone URL if repo missing (default: https://github.com/dujavi/.ai-md.git)

Examples:
  ai-md install
  ai-md pull
  ai-md push -m "Add grafana rule"
  ai-md status
  ai-md doctor --fix
  npx -y @dujavi/ai-md pull
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

ensure_repo() {
  if [[ ! -d "$REPO/.git" ]]; then
    err "$REPO is not a git repo."
    err "  git clone $REMOTE_URL $REPO"
    err "  or: ai-md install"
    exit 1
  fi
}

clone_if_missing() {
  if [[ -d "$REPO/.git" ]]; then
    return 0
  fi

  # One-time migration from the old ~/.cursor-md layout.
  local legacy="$HOME/.cursor-md"
  if [[ "$REPO" == "$HOME/.ai-md" ]] && [[ -d "$legacy/.git" ]] && [[ ! -e "$REPO" ]]; then
    log "Migrating $legacy → $REPO"
    run mv "$legacy" "$REPO"
    return 0
  fi

  if [[ -e "$REPO" ]] && [[ ! -d "$REPO" ]]; then
    err "$REPO exists and is not a directory"
    exit 1
  fi
  if [[ -d "$REPO" ]] && [[ -n "$(ls -A "$REPO" 2>/dev/null || true)" ]]; then
    err "$REPO exists but is not a git repo (and is not empty)"
    exit 1
  fi
  log "Cloning $REMOTE_URL → $REPO"
  run git clone "$REMOTE_URL" "$REPO"
}

link_path() {
  local target="$1"
  local link="$2"
  local link_dir

  mkdir -p "$(dirname "$link")"
  mkdir -p "$target"

  if [[ -L "$link" ]]; then
    local current
    current="$(readlink "$link")"
    if [[ "$current" == "$target" ]]; then
      log "ok: $link → $target"
      return 0
    fi
    log "repair: $link (was → $current)"
    run ln -sfn "$target" "$link"
    return 0
  fi

  if [[ -e "$link" ]]; then
    if [[ "$FORCE" -ne 1 ]]; then
      err "$link exists and is not a symlink (use --force to replace)"
      err "  expected → $target"
      return 1
    fi
    log "replace: $link (was a real path; --force)"
    run rm -rf "$link"
  fi

  link_dir="$(dirname "$link")"
  run mkdir -p "$link_dir"
  run ln -sfn "$target" "$link"
  log "linked: $link → $target"
}

ensure_symlinks() {
  local rc=0
  link_path "$REPO/skills" "$HOME/.cursor/skills" || rc=1
  link_path "$REPO/rules" "$HOME/.cursor/rules" || rc=1
  return "$rc"
}

count_rules() {
  find "$REPO/rules" -maxdepth 1 -type f \( -name '*.mdc' -o -name '*.md' \) 2>/dev/null | wc -l | tr -d ' '
}

count_skills() {
  find "$REPO/skills" -mindepth 1 -maxdepth 1 -type d ! -name '.*' 2>/dev/null | wc -l | tr -d ' '
}

cmd_install() {
  clone_if_missing
  ensure_repo
  ensure_symlinks
  log "Install complete."
  log "  rules:  $(count_rules)"
  log "  skills: $(count_skills)"
  log "Next: ai-md ensure-tools  # grok + quota-axi"
}

cmd_pull() {
  ensure_repo
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "dry-run: git -C $REPO pull --rebase --autostash"
  else
    git -C "$REPO" pull --rebase --autostash
  fi
  ensure_symlinks
  log "Pulled $REPO; symlinks refreshed."
}

cmd_push() {
  ensure_repo
  ensure_symlinks
  if [[ "$DRY_RUN" -eq 1 ]]; then
    git -C "$REPO" status -sb
    log "dry-run: would add/commit/push with message: $COMMIT_MSG"
    return 0
  fi
  git -C "$REPO" add -A
  if git -C "$REPO" diff --cached --quiet; then
    log "Nothing to commit in $REPO."
  else
    git -C "$REPO" commit -m "$COMMIT_MSG"
  fi
  git -C "$REPO" push
  log "Pushed $REPO."
}

cmd_status() {
  ensure_repo
  log "Repo: $REPO"
  log "Branch: $(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
  log "Remote: $(git -C "$REPO" remote get-url origin 2>/dev/null || echo '(none)')"
  log ""
  log "Global symlinks:"
  for name in skills rules; do
    local path="$HOME/.cursor/$name"
    if [[ -L "$path" ]]; then
      log "  $path → $(readlink "$path")"
    elif [[ -e "$path" ]]; then
      log "  $path  (exists, NOT a symlink)"
    else
      log "  $path  (missing)"
    fi
  done
  log ""
  log "Counts: $(count_rules) rules, $(count_skills) skills"
  log ""
  git -C "$REPO" status -sb
}

cmd_doctor() {
  ensure_repo
  local problems=0

  for name in skills rules; do
    local path="$HOME/.cursor/$name"
    local expected="$REPO/$name"
    if [[ ! -L "$path" ]]; then
      err "symlink missing or wrong type: $path"
      problems=$((problems + 1))
    elif [[ "$(readlink "$path")" != "$expected" ]]; then
      err "symlink target wrong: $path → $(readlink "$path") (want $expected)"
      problems=$((problems + 1))
    fi
  done

  if ! git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    err "not a git work tree: $REPO"
    problems=$((problems + 1))
  fi

  if [[ "$problems" -eq 0 ]]; then
    log "doctor: healthy ($(count_rules) rules, $(count_skills) skills)"
    return 0
  fi

  log "doctor: $problems issue(s)"
  if [[ "${1:-}" == "--fix" ]] || [[ "$FORCE" -eq 1 ]]; then
    ensure_symlinks
    log "doctor: attempted repair"
  else
    err "Re-run with: ai-md doctor --fix"
    return 1
  fi
}

# --- arg parse ---
CMD=""
FIX=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    install|pull|push|status|doctor)
      CMD="$1"
      shift
      ;;
    -m|--message)
      COMMIT_MSG="${2:?--message requires a value}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --fix)
      FIX=1
      FORCE=1
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

if [[ -z "$CMD" ]]; then
  usage
  exit 1
fi

case "$CMD" in
  install) cmd_install ;;
  pull)    cmd_pull ;;
  push)    cmd_push ;;
  status)  cmd_status ;;
  doctor)
    if [[ "$FIX" -eq 1 ]]; then
      cmd_doctor --fix
    else
      cmd_doctor
    fi
    ;;
esac
