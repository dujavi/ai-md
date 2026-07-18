#!/usr/bin/env bash
# Ensure Grok Build CLI + quota-axi are installed on this machine.
# Safe to re-run (idempotent). Does not print secrets.
set -euo pipefail

DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: ensure-agent-tools.sh [--dry-run]

Installs or updates:
  - grok   (Grok Build CLI) via https://x.ai/cli/install.sh
  - quota-axi via volta (if present) or npm -g

Then prints version + auth/quota smoke checks (no secrets).
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
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help|help) usage; exit 0 ;;
    *) err "unknown argument: $1"; usage; exit 1 ;;
  esac
done

ensure_path_hint() {
  local need=0
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) need=1; log "note: add \$HOME/.local/bin to PATH" ;;
  esac
  case ":$PATH:" in
    *":$HOME/.grok/bin:"*) ;;
    *) need=1; log "note: add \$HOME/.grok/bin to PATH (grok installer usually does)" ;;
  esac
  return 0
}

install_grok() {
  if command -v grok >/dev/null 2>&1; then
    log "grok present: $(grok --version 2>/dev/null || echo unknown)"
    log "Updating grok via official installer…"
  else
    log "Installing grok via official installer…"
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "dry-run: curl -fsSL https://x.ai/cli/install.sh | bash"
    return 0
  fi
  curl -fsSL https://x.ai/cli/install.sh | bash
}

install_quota_axi() {
  if command -v quota-axi >/dev/null 2>&1; then
    log "quota-axi present: $(quota-axi --version 2>/dev/null || echo unknown)"
  else
    log "Installing quota-axi…"
  fi
  if command -v volta >/dev/null 2>&1; then
    run volta install quota-axi
  elif command -v npm >/dev/null 2>&1; then
    run npm install -g quota-axi
  else
    err "Need volta or npm to install quota-axi"
    return 1
  fi
}

smoke() {
  log ""
  log "=== smoke checks ==="
  if command -v grok >/dev/null 2>&1; then
    log "grok: $(command -v grok)"
    grok --version 2>&1 || true
    if [[ -f "$HOME/.grok/auth.json" ]]; then
      log "grok auth: ~/.grok/auth.json present"
    else
      log "grok auth: missing — run \`grok\` (browser) or set XAI_API_KEY"
    fi
  else
    err "grok not on PATH after install"
  fi

  if command -v quota-axi >/dev/null 2>&1; then
    log "quota-axi: $(command -v quota-axi)"
    quota-axi auth 2>&1 || true
    quota-axi --provider grok 2>&1 || true
  else
    err "quota-axi not on PATH after install"
  fi

  if ! command -v sqlite3 >/dev/null 2>&1; then
    log "note: sqlite3 not found — Cursor quota via quota-axi may fail (install sqlite3)"
  fi
}

ensure_path_hint
install_grok
install_quota_axi
smoke
log ""
log "Done. Re-run anytime; pair with: ai-md install"
