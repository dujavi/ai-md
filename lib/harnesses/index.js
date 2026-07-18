"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { expandHome } = require("../config-paths");

/** Built-in harness registry. codex aliases agents (shared ~/.agents/skills). */
const BUILTINS = {
  cursor: {
    id: "cursor",
    tier: "A",
    format: "mdc",
    emitter: "full",
    skills: "~/.cursor/skills",
    rules: "~/.cursor/rules",
    unique: true,
    aliasOf: null,
    detect: { dirs: ["~/.cursor"], bins: ["cursor", "agent"] },
  },
  claude: {
    id: "claude",
    tier: "A",
    format: "md",
    emitter: "full",
    skills: "~/.claude/skills",
    rules: "~/.claude/rules",
    unique: true,
    aliasOf: null,
    detect: { dirs: ["~/.claude"], bins: ["claude"] },
  },
  agents: {
    id: "agents",
    tier: "A",
    format: "skills-only",
    emitter: "full",
    skills: "~/.agents/skills",
    rules: null,
    unique: false,
    aliasOf: null,
    detect: { dirs: ["~/.agents", "~/.codex"], bins: ["codex"] },
  },
  codex: {
    id: "codex",
    tier: "A",
    format: "skills-only",
    emitter: "full",
    skills: "~/.agents/skills",
    rules: null,
    unique: false,
    aliasOf: "agents",
    detect: { dirs: ["~/.codex", "~/.agents"], bins: ["codex"] },
  },
  gemini: {
    id: "gemini",
    tier: "A",
    format: "skills-only",
    emitter: "full",
    skills: "~/.gemini/skills",
    rules: null,
    unique: true,
    aliasOf: null,
    detect: { dirs: ["~/.gemini"], bins: ["gemini"] },
  },
  opencode: {
    id: "opencode",
    tier: "A",
    format: "skills-only",
    emitter: "full",
    skills: "~/.config/opencode/skills",
    rules: null,
    unique: true,
    aliasOf: null,
    detect: { dirs: ["~/.config/opencode"], bins: ["opencode"] },
  },
  copilot: {
    id: "copilot",
    tier: "B",
    format: "skills-only",
    emitter: "stub",
    skills: "~/.copilot/skills",
    rules: null,
    unique: true,
    aliasOf: null,
    detect: { dirs: ["~/.copilot"], bins: ["copilot"] },
  },
  windsurf: {
    id: "windsurf",
    tier: "B",
    format: "skills-only",
    emitter: "stub",
    skills: null,
    rules: null,
    unique: true,
    aliasOf: null,
    detect: { dirs: ["~/.codeium"], bins: ["windsurf"] },
  },
  grok: {
    id: "grok",
    tier: "B",
    format: "skills-only",
    emitter: "stub",
    skills: null,
    rules: null,
    unique: true,
    aliasOf: null,
    detect: { dirs: ["~/.grok"], bins: ["grok"] },
  },
};

function which(bin) {
  const pathEnv = process.env.PATH || "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

function dirExists(p) {
  try {
    return fs.statSync(expandHome(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * True if the harness looks installed on this machine.
 * Custom harnesses: installed if any configured live parent exists, or always if --force-link.
 */
function isHarnessInstalled(def, { forceLink = false } = {}) {
  if (forceLink) return true;
  if (!def) return false;
  if (def.detect) {
    for (const d of def.detect.dirs || []) {
      if (dirExists(d)) return true;
    }
    for (const b of def.detect.bins || []) {
      if (which(b)) return true;
    }
  }
  // Custom / override: consider installed if skills or rules parent exists
  if (def.skills && dirExists(path.dirname(expandHome(def.skills)))) return true;
  if (def.rules && dirExists(path.dirname(expandHome(def.rules)))) return true;
  // Built-in with no detect hit
  if (BUILTINS[def.id] && def.emitter === "stub" && !def.skills) return false;
  if (!BUILTINS[def.id] && (def.skills || def.rules)) {
    // user-registered: require parent dir or force
    return false;
  }
  return false;
}

function getBuiltin(id) {
  return BUILTINS[String(id).toLowerCase()] || null;
}

function listBuiltinIds() {
  return Object.keys(BUILTINS).sort();
}

/**
 * Merge built-in + machine config harnesses.<id> overrides.
 * @returns {object} resolved harness definition
 */
function resolveHarness(id, cfg, oneShot = {}) {
  const key = String(id).toLowerCase();
  const builtin = getBuiltin(key);
  const overrides = (cfg.machineConfig && cfg.machineConfig.harnesses) || {};
  const over = overrides[key] || {};

  const base = builtin
    ? { ...builtin }
    : {
        id: key,
        tier: "C",
        format: "skills-only",
        emitter: "full",
        skills: null,
        rules: null,
        unique: true,
        aliasOf: null,
        detect: null,
        custom: true,
      };

  const skills =
    oneShot.skills ||
    over.skills ||
    base.skills;
  const rules =
    oneShot.rules !== undefined
      ? oneShot.rules
      : over.rules !== undefined
        ? over.rules
        : base.rules;
  const format =
    oneShot.format ||
    over.format ||
    base.format ||
    (skills && rules ? "md" : "skills-only");

  const enabled =
    over.enabled !== undefined
      ? Boolean(over.enabled)
      : builtin
        ? true
        : true;

  const distId = base.aliasOf || key;

  return {
    ...base,
    id: key,
    skills: skills ? expandHome(skills) : null,
    rules: rules ? expandHome(rules) : null,
    skillsRaw: skills || null,
    rulesRaw: rules || null,
    format,
    enabled,
    distId,
    override: Boolean(over.skills || over.rules || over.format || over.enabled !== undefined),
  };
}

/**
 * Expand enabled agent list: drop aliases that duplicate canonical, warn.
 * Filters to installed harnesses unless forceLink.
 */
function selectHarnesses(cfg, agentIds, { forceLink = false, includeUninstalled = false } = {}) {
  const requested = (agentIds && agentIds.length ? agentIds : cfg.agents || ["cursor"]).map(
    (a) => String(a).trim().toLowerCase()
  );
  const seenLive = new Map(); // live skills path -> id
  const selected = [];
  const skipped = [];
  const warnings = [];

  for (const id of requested) {
    let def;
    try {
      def = resolveHarness(id, cfg);
    } catch (e) {
      skipped.push({ id, reason: e.message });
      continue;
    }
    if (!def.enabled) {
      skipped.push({ id, reason: "disabled" });
      continue;
    }
    if (def.emitter === "stub" && !def.skills && !def.rules) {
      skipped.push({ id, reason: "stub_no_paths" });
      continue;
    }
    if (!includeUninstalled && !isHarnessInstalled(def, { forceLink })) {
      skipped.push({ id, reason: "not_installed" });
      continue;
    }
    if (def.aliasOf) {
      warnings.push(`${id} is an alias of ${def.aliasOf}; using dist/${def.distId}`);
    }
    const liveKey = def.skills || def.rules || def.id;
    if (seenLive.has(liveKey)) {
      warnings.push(
        `skip ${id}: shares live path with ${seenLive.get(liveKey)} (${liveKey})`
      );
      skipped.push({ id, reason: "shared_live_path", with: seenLive.get(liveKey) });
      continue;
    }
    seenLive.set(liveKey, def.distId);
    selected.push(def);
  }

  return { selected, skipped, warnings };
}

function ensureAgentSourceDirs(cfg, harnessId) {
  const id = harnessId === "codex" ? "agents" : harnessId;
  const root = path.join(cfg.dir, "agents", id);
  fs.mkdirSync(path.join(root, "rules"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  return root;
}

module.exports = {
  BUILTINS,
  getBuiltin,
  listBuiltinIds,
  resolveHarness,
  selectHarnesses,
  isHarnessInstalled,
  ensureAgentSourceDirs,
  which,
  dirExists,
};
