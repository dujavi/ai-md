"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function resolveConfig(env = process.env) {
  const home = os.homedir();
  const dir =
    env.AI_MD_DIR || env.CURSOR_MD_DIR || path.join(home, ".ai-md");
  const remote =
    env.AI_MD_REMOTE ||
    env.CURSOR_MD_REMOTE ||
    "https://github.com/dujavi/.ai-md.git";
  return {
    home,
    dir,
    remote,
    cursorSkills: path.join(home, ".cursor", "skills"),
    cursorRules: path.join(home, ".cursor", "rules"),
    projectsDir: path.join(dir, "projects"),
    templateDir: path.join(dir, "projects", "template"),
    skillsDir: path.join(dir, "skills"),
    rulesDir: path.join(dir, "rules"),
  };
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

module.exports = {
  resolveConfig,
  countRules,
  countSkills,
  listSkillNames,
  listRuleNames,
  symlinkState,
  agentSkillTargets,
};
