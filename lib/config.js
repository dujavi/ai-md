"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { expandHome } = require("./config-paths");

const DEFAULT_REMOTE = "https://github.com/dujavi/.ai-md.git";

function machineConfigPath(env = process.env) {
  if (env.AI_MD_CONFIG) return expandHome(env.AI_MD_CONFIG);
  const xdg =
    env.XDG_CONFIG_HOME ||
    path.join(require("os").homedir(), ".config");
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

function writeMachineConfig(patch, env = process.env, { dryRun = false } = {}) {
  const configPath = machineConfigPath(env);
  const existing = readMachineConfig(env).raw || {};
  const next = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  if (patch.dir != null) next.dir = expandHome(patch.dir);
  if (patch.remote != null) next.remote = String(patch.remote);
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

function resolveConfig(env = process.env, opts = {}) {
  const os = require("os");
  const { defaultLinkMode } = require("./config-paths");
  const home = os.homedir();
  const stored = readMachineConfig(env);
  const defaultDir = path.join(home, ".ai-md");

  const envDir = env.AI_MD_DIR || env.CURSOR_MD_DIR || null;
  const envRemote = env.AI_MD_REMOTE || env.CURSOR_MD_REMOTE || null;

  const dir = expandHome(opts.dir || envDir || stored.dir || defaultDir);
  const remote = opts.remote || envRemote || stored.remote || DEFAULT_REMOTE;

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

  const raw = stored.raw || {};
  const agents = Array.isArray(raw.agents) && raw.agents.length
    ? raw.agents.map((a) => String(a).toLowerCase())
    : ["cursor"];
  const linkMode = opts.linkMode || raw.linkMode || defaultLinkMode();

  const templatesDir = path.join(dir, "templates");
  return {
    home,
    dir,
    remote,
    sources,
    agents,
    linkMode,
    machineConfigPath: stored.path,
    machineConfig: raw,
    cursorSkills: path.join(home, ".cursor", "skills"),
    cursorRules: path.join(home, ".cursor", "rules"),
    projectsDir: path.join(dir, "projects"),
    templatesDir,
    templateDir: path.join(templatesDir, "base"),
    // legacy aliases → shared (build uses shared/)
    skillsDir: path.join(dir, "shared", "skills"),
    rulesDir: path.join(dir, "shared", "rules"),
    sharedDir: path.join(dir, "shared"),
    agentsDir: path.join(dir, "agents"),
    distDir: path.join(dir, "dist"),
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
    .filter((f) => f.endsWith(".mdc") || f.endsWith(".md")).length;
}

function countSkills(skillsDir) {
  if (!fs.existsSync(skillsDir)) return 0;
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".")).length;
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
  const { linkState } = require("./link");
  return linkState(linkPath, expected);
}

/** @deprecated use harnesses.selectHarnesses */
function agentSkillTargets(home, agents) {
  const { resolveHarness } = require("./harnesses");
  const cfg = { home, machineConfig: {} };
  return (agents || [])
    .map((a) => {
      try {
        const h = resolveHarness(a, { ...cfg, home });
        return h.skills ? { name: h.id, path: h.skills } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
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

function gitClone(remote, dir, { dryRun = false } = {}) {
  if (dryRun) return { action: "would_clone", remote, dir };
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync("git", ["clone", remote, dir], { stdio: "inherit" });
  return { action: "cloned", remote, dir };
}

function gitPull(dir, { dryRun = false } = {}) {
  if (dryRun) return { action: "would_pull", dir };
  execFileSync("git", ["-C", dir, "pull", "--rebase", "--autostash"], {
    stdio: "inherit",
  });
  return { action: "pulled", dir };
}

function gitPush(dir, { message, dryRun = false } = {}) {
  if (dryRun) return { action: "would_push", dir, message };
  execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "inherit" });
  let dirty = true;
  try {
    execFileSync("git", ["-C", dir, "diff", "--cached", "--quiet"], {
      stdio: "pipe",
    });
    dirty = false;
  } catch {
    dirty = true;
  }
  if (dirty) {
    execFileSync(
      "git",
      ["-C", dir, "commit", "-m", message || "Update personal AI skills/rules"],
      { stdio: "inherit" }
    );
  }
  execFileSync("git", ["-C", dir, "push"], { stdio: "inherit" });
  return { action: "pushed", dir, committed: dirty };
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
  gitClone,
  gitPull,
  gitPush,
};
