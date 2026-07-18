"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  resolveConfig,
  countRules,
  countSkills,
  listSkillNames,
  listRuleNames,
  symlinkState,
  agentSkillTargets,
} = require("./config");

function git(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    return null;
  }
}

function templateDrift(projectDir, templateDir) {
  if (!fs.existsSync(templateDir)) {
    return { missingRules: [], missingSkills: [], extraRules: [], extraSkills: [] };
  }
  const tRules = new Set(listRuleNames(path.join(templateDir, "rules")));
  const tSkills = new Set(listSkillNames(path.join(templateDir, "skills")));
  const pRules = new Set(listRuleNames(path.join(projectDir, "rules")));
  const pSkills = new Set(listSkillNames(path.join(projectDir, "skills")));
  return {
    missingRules: [...tRules].filter((r) => !pRules.has(r)),
    missingSkills: [...tSkills].filter((s) => !pSkills.has(s)),
    extraRules: [...pRules].filter((r) => !tRules.has(r)),
    extraSkills: [...pSkills].filter((s) => !tSkills.has(s)),
  };
}

function collectProjects(cfg, { full = false } = {}) {
  const projects = [];
  if (!fs.existsSync(cfg.projectsDir)) return projects;
  for (const name of fs.readdirSync(cfg.projectsDir).sort()) {
    if (name.startsWith(".")) continue;
    const projectDir = path.join(cfg.projectsDir, name);
    if (!fs.statSync(projectDir).isDirectory()) continue;
    if (name === "template") {
      projects.push({
        name,
        kind: "template",
        rules: countRules(path.join(projectDir, "rules")),
        skills: countSkills(path.join(projectDir, "skills")),
        missingRules: 0,
        missingSkills: 0,
        ...(full
          ? {
              path: projectDir,
              drift: templateDrift(projectDir, cfg.templateDir),
            }
          : {}),
      });
      continue;
    }
    const drift = templateDrift(projectDir, cfg.templateDir);
    projects.push({
      name,
      kind: "project",
      rules: countRules(path.join(projectDir, "rules")),
      skills: countSkills(path.join(projectDir, "skills")),
      missingRules: drift.missingRules.length,
      missingSkills: drift.missingSkills.length,
      ...(full
        ? {
            path: projectDir,
            drift,
          }
        : {}),
    });
  }
  return projects;
}

function collectStatus(opts = {}) {
  const cfg = resolveConfig();
  const full = Boolean(opts.full);
  const agents = opts.agents || ["cursor"];

  const exists = fs.existsSync(cfg.dir);
  const isGit = exists && fs.existsSync(path.join(cfg.dir, ".git"));

  const links = [
    symlinkState(cfg.cursorSkills, cfg.skillsDir),
    symlinkState(cfg.cursorRules, cfg.rulesDir),
  ];

  const agentLinks = agentSkillTargets(cfg.home, agents)
    .filter((t) => t.name !== "cursor")
    .map((t) => ({
      agent: t.name,
      ...symlinkState(t.path, cfg.skillsDir),
    }));

  const projects = collectProjects(cfg, { full });
  const linkedProjects = projects.filter((p) => p.kind === "project");
  const drifting = linkedProjects.filter(
    (p) => p.missingRules > 0 || p.missingSkills > 0
  );

  let branch = null;
  let remote = null;
  let dirty = false;
  let aheadBehind = null;
  if (isGit) {
    branch = git(cfg.dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    remote = git(cfg.dir, ["remote", "get-url", "origin"]);
    const porcelain = git(cfg.dir, ["status", "--porcelain"]);
    dirty = Boolean(porcelain && porcelain.length);
    aheadBehind = git(cfg.dir, ["status", "-sb"]) || null;
  }

  const problems = [];
  if (!exists) problems.push("ai_md_missing");
  else if (!isGit) problems.push("ai_md_not_git");
  for (const l of links) {
    if (l.state !== "ok") problems.push(`cursor_${path.basename(l.path)}_${l.state}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    dir: cfg.dir,
    remote: remote || cfg.remote,
    branch,
    dirty,
    statusLine: aheadBehind,
    counts: {
      rules: countRules(cfg.rulesDir),
      skills: countSkills(cfg.skillsDir),
      projects: linkedProjects.length,
      drifting: drifting.length,
      problems: problems.length,
    },
    links: links.map((l) => ({
      path: l.path,
      state: l.state,
      ...(full ? { target: l.target, expected: l.expected } : {}),
    })),
    agentLinks: agentLinks.map((l) => ({
      agent: l.agent,
      path: l.path,
      state: l.state,
      ...(full ? { target: l.target, expected: l.expected } : {}),
    })),
    projects: projects.map((p) =>
      full
        ? p
        : {
            name: p.name,
            kind: p.kind,
            rules: p.rules,
            skills: p.skills,
            missingRules: p.missingRules,
            missingSkills: p.missingSkills,
          }
    ),
    problems,
  };
}

function statusHelp(data) {
  const help = [];
  if (data.problems.includes("ai_md_missing") || data.problems.includes("ai_md_not_git")) {
    help.push("Run `ai-md install` to clone AI_MD_REMOTE → ~/.ai-md and link ~/.cursor/{skills,rules}");
  }
  if (data.links.some((l) => l.state !== "ok")) {
    help.push("Run `ai-md doctor --fix` to repair ~/.cursor skills/rules symlinks");
  }
  if (data.counts.drifting > 0) {
    help.push(
      "Run `ai-md apply-template --project <name>` to merge missing baseline files from projects/template"
    );
  }
  if (data.dirty) {
    help.push('Run `ai-md push -m "<why>"` to commit and push private config');
  } else {
    help.push("Run `ai-md pull` before editing global skills/rules");
  }
  help.push("Run `ai-md init-project --repo <path>` to seed a project from template and link .cursor/");
  help.push("Run `ai-md status --json` for machine-readable output");
  return help;
}

module.exports = {
  collectStatus,
  collectProjects,
  templateDrift,
  statusHelp,
  git,
};
