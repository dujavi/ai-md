"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  resolveConfig,
  templatePath,
  listTemplates,
  migrateLegacyTemplate,
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
  } catch {
    return null;
  }
}

function templateDrift(projectDir, tmplDir) {
  if (!fs.existsSync(tmplDir)) {
    return { missingRules: [], missingSkills: [], extraRules: [], extraSkills: [] };
  }
  const tRules = new Set(listRuleNames(path.join(tmplDir, "rules")));
  const tSkills = new Set(listSkillNames(path.join(tmplDir, "skills")));
  const pRules = new Set(listRuleNames(path.join(projectDir, "rules")));
  const pSkills = new Set(listSkillNames(path.join(projectDir, "skills")));
  return {
    missingRules: [...tRules].filter((r) => !pRules.has(r)),
    missingSkills: [...tSkills].filter((s) => !pSkills.has(s)),
    extraRules: [...pRules].filter((r) => !tRules.has(r)),
    extraSkills: [...pSkills].filter((s) => !tSkills.has(s)),
  };
}

function collectTemplates(cfg, { full = false } = {}) {
  return listTemplates(cfg).map((name) => {
    const dir = templatePath(cfg, name);
    return {
      name,
      rules: countRules(path.join(dir, "rules")),
      skills: countSkills(path.join(dir, "skills")),
      ...(full ? { path: dir } : {}),
    };
  });
}

function collectProjects(cfg, { full = false, from = "base" } = {}) {
  const projects = [];
  const tmplDir = templatePath(cfg, from);
  if (!fs.existsSync(cfg.projectsDir)) return projects;
  for (const name of fs.readdirSync(cfg.projectsDir).sort()) {
    if (name.startsWith(".")) continue;
    // legacy leftover
    if (name === "template") continue;
    const projectDir = path.join(cfg.projectsDir, name);
    if (!fs.statSync(projectDir).isDirectory()) continue;
    const drift = templateDrift(projectDir, tmplDir);
    projects.push({
      name,
      kind: "project",
      from,
      rules: countRules(path.join(projectDir, "rules")),
      skills: countSkills(path.join(projectDir, "skills")),
      missingRules: drift.missingRules.length,
      missingSkills: drift.missingSkills.length,
      ...(full ? { path: projectDir, drift } : {}),
    });
  }
  return projects;
}

function collectStatus(opts = {}) {
  const cfg = resolveConfig();
  const full = Boolean(opts.full);
  const agents = opts.agents || ["cursor"];
  const from = opts.from || "base";

  const migration = migrateLegacyTemplate(cfg);

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

  const templates = collectTemplates(cfg, { full });
  const projects = collectProjects(cfg, { full, from });
  const drifting = projects.filter(
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
  if (!fs.existsSync(templatePath(cfg, "base")) && templates.length === 0) {
    problems.push("templates_missing");
  }

  return {
    generatedAt: new Date().toISOString(),
    dir: cfg.dir,
    remote: remote || cfg.remote,
    branch,
    dirty,
    statusLine: aheadBehind,
    layout: {
      system: { rules: cfg.rulesDir, skills: cfg.skillsDir },
      templates: cfg.templatesDir,
      projects: cfg.projectsDir,
    },
    migration,
    counts: {
      rules: countRules(cfg.rulesDir),
      skills: countSkills(cfg.skillsDir),
      templates: templates.length,
      projects: projects.length,
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
    templates,
    projects,
    driftFrom: from,
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
  if (data.problems.includes("templates_missing")) {
    help.push("Create ~/.ai-md/templates/base with project starters (system skills/rules stay in skills/ and rules/)");
  }
  if (data.counts.drifting > 0) {
    help.push(
      `Run \`ai-md apply-template --project <name> --from ${data.driftFrom || "base"}\` to merge missing template files`
    );
  }
  if (data.dirty) {
    help.push('Run `ai-md push -m "<why>"` to commit and push private config');
  } else {
    help.push("Edit system skills/rules under ~/.ai-md/{skills,rules}; project overlays under projects/");
  }
  help.push("Run `ai-md init-project --repo <path> --from base` to seed a project");
  help.push("Run `ai-md status --json` for machine-readable output");
  return help;
}

module.exports = {
  collectStatus,
  collectProjects,
  collectTemplates,
  templateDrift,
  statusHelp,
  git,
};
