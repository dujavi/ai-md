"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_REMOTE = "https://github.com/dujavi/.ai-md.git";

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Machine-local config (not inside the private content repo). */
function machineConfigPath(env = process.env) {
  if (env.AI_MD_CONFIG) return expandHome(env.AI_MD_CONFIG);
  const xdg = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdg, "ai-md", "config.json");
}

function readMachineConfig(env = process.env) {
  const configPath = machineConfigPath(env);
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const data = JSON.parse(raw);
    return {
      path: configPath,
      dir: data.dir ? expandHome(String(data.dir)) : null,
      remote: data.remote ? String(data.remote) : null,
      raw: data,
    };
  } catch {
    return { path: configPath, dir: null, remote: null, raw: null };
  }
}

function writeMachineConfig({ dir, remote }, env = process.env, { dryRun = false } = {}) {
  const configPath = machineConfigPath(env);
  const existing = readMachineConfig(env).raw || {};
  const next = {
    ...existing,
    ...(dir != null ? { dir: expandHome(dir) } : {}),
    ...(remote != null ? { remote: String(remote) } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (!next.dir && !next.remote) {
    const err = new Error("nothing to write: provide --dir and/or --remote");
    err.code = "EINVAL";
    throw err;
  }
  if (dryRun) {
    return { action: "would_write", path: configPath, config: next };
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    /* best effort */
  }
  return { action: "wrote", path: configPath, config: next };
}

/**
 * Precedence: explicit opts > env > machine config file > defaults.
 * @param {{ dir?: string, remote?: string }} [opts]
 */
function resolveConfig(env = process.env, opts = {}) {
  const home = os.homedir();
  const stored = readMachineConfig(env);
  const defaultDir = path.join(home, ".ai-md");

  const envDir = env.AI_MD_DIR || env.CURSOR_MD_DIR || null;
  const envRemote = env.AI_MD_REMOTE || env.CURSOR_MD_REMOTE || null;

  const dir = expandHome(
    opts.dir || envDir || stored.dir || defaultDir
  );
  const remote =
    opts.remote || envRemote || stored.remote || DEFAULT_REMOTE;

  const sources = {
    dir: opts.dir
      ? "flag"
      : envDir && !(stored.dir && expandHome(envDir) === stored.dir)
        ? "env"
        : stored.dir
          ? "config"
          : "default",
    remote: opts.remote
      ? "flag"
      : envRemote && !(stored.remote && envRemote === stored.remote)
        ? "env"
        : stored.remote
          ? "config"
          : "default",
  };

  const templatesDir = path.join(dir, "templates");
  return {
    home,
    dir,
    remote,
    sources,
    machineConfigPath: stored.path,
    machineConfig: stored.raw,
    cursorSkills: path.join(home, ".cursor", "skills"),
    cursorRules: path.join(home, ".cursor", "rules"),
    projectsDir: path.join(dir, "projects"),
    templatesDir,
    templateDir: path.join(templatesDir, "base"),
    skillsDir: path.join(dir, "skills"),
    rulesDir: path.join(dir, "rules"),
  };
}

function applyEnvFromConfig(cfg) {
  process.env.AI_MD_DIR = cfg.dir;
  process.env.AI_MD_REMOTE = cfg.remote;
  process.env.CURSOR_MD_DIR = cfg.dir;
  process.env.CURSOR_MD_REMOTE = cfg.remote;
}

function templatePath(cfg, name = "base") {
  return path.join(cfg.templatesDir, name);
}

function listTemplates(cfg) {
  if (!fs.existsSync(cfg.templatesDir)) return [];
  return fs
    .readdirSync(cfg.templatesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

function countRules(rulesDir) {
  if (!fs.existsSync(rulesDir)) return 0;
  return fs
    .readdirSync(rulesDir)
    .filter((f) => f.endsWith(".mdc") || f.endsWith(".md"))
    .length;
}

function countSkills(skillsDir) {
  if (!fs.existsSync(skillsDir)) return 0;
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .length;
}

function listSkillNames(skillsDir) {
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

function listRuleNames(rulesDir) {
  if (!fs.existsSync(rulesDir)) return [];
  return fs
    .readdirSync(rulesDir)
    .filter((f) => f.endsWith(".mdc") || f.endsWith(".md"))
    .sort();
}

function symlinkState(linkPath, expected) {
  let stat;
  try {
    stat = fs.lstatSync(linkPath);
  } catch {
    return { path: linkPath, state: "missing", target: null, expected };
  }
  if (!stat.isSymbolicLink()) {
    return { path: linkPath, state: "not_symlink", target: null, expected };
  }
  const target = fs.readlinkSync(linkPath);
  if (target === expected) {
    return { path: linkPath, state: "ok", target, expected };
  }
  return { path: linkPath, state: "wrong_target", target, expected };
}

function agentSkillTargets(home, agents) {
  const map = {
    cursor: path.join(home, ".cursor", "skills"),
    claude: path.join(home, ".claude", "skills"),
    agents: path.join(home, ".agents", "skills"),
  };
  return (agents || [])
    .map((a) => String(a).trim().toLowerCase())
    .filter(Boolean)
    .filter((name) => map[name])
    .map((name) => ({ name, path: map[name] }));
}

function migrateLegacyTemplate(cfg, { dryRun = false } = {}) {
  const legacy = path.join(cfg.projectsDir, "template");
  const dest = templatePath(cfg, "base");
  if (!fs.existsSync(legacy) || fs.existsSync(dest)) {
    return { action: "skip" };
  }
  if (dryRun) return { action: "would_migrate", from: legacy, to: dest };
  fs.mkdirSync(cfg.templatesDir, { recursive: true });
  fs.renameSync(legacy, dest);
  return { action: "migrated", from: legacy, to: dest };
}

module.exports = {
  DEFAULT_REMOTE,
  machineConfigPath,
  readMachineConfig,
  writeMachineConfig,
  resolveConfig,
  applyEnvFromConfig,
  expandHome,
  templatePath,
  listTemplates,
  migrateLegacyTemplate,
  countRules,
  countSkills,
  listSkillNames,
  listRuleNames,
  symlinkState,
  agentSkillTargets,
};
