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
} = require("./config");
const { linkState } = require("./link");
const { distRoot, distDirty, sharedRoots } = require("./build");
const {
  selectHarnesses,
  resolveHarness,
  isHarnessInstalled,
} = require("./harnesses");
const { isWsl } = require("./config-paths");
const { SKELETON_VERSION } = require("./skeleton");

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
    if (name.startsWith(".") || name === "template") continue;
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
  const agents = opts.agents || cfg.agents || ["cursor"];
  const from = opts.from || "base";

  const migration = migrateLegacyTemplate(cfg);
  const exists = fs.existsSync(cfg.dir);
  const isGit = exists && fs.existsSync(path.join(cfg.dir, ".git"));
  const shared = sharedRoots(cfg);

  const { selected, skipped, warnings } = selectHarnesses(cfg, agents, {
    forceLink: false,
    includeUninstalled: true,
  });

  const links = [];
  const harnesses = [];
  for (const h of selected) {
    const installed = isHarnessInstalled(h);
    const dist = distRoot(cfg, h.distId);
    const dirty = distDirty(dist);
    const entry = {
      id: h.id,
      distId: h.distId,
      installed,
      aliasOf: h.aliasOf,
      format: h.format,
      distDirty: dirty.dirty,
      ...(full && dirty.dirty ? { dirtyFiles: dirty.files } : {}),
    };
    if (installed) {
      if (h.skills) {
        const st = linkState(h.skills, path.join(dist, "skills"));
        links.push({ harness: h.id, kind: "skills", ...st });
        entry.skillsLink = st.state;
      }
      if (h.rules && h.format !== "skills-only") {
        const st = linkState(h.rules, path.join(dist, "rules"));
        links.push({ harness: h.id, kind: "rules", ...st });
        entry.rulesLink = st.state;
      }
    } else {
      entry.skillsLink = "skipped_not_installed";
    }
    harnesses.push(entry);
  }

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
  if (fs.existsSync(path.join(cfg.dir, "rules")) || fs.existsSync(path.join(cfg.dir, "skills"))) {
    problems.push("legacy_flat_layout");
  }
  for (const l of links) {
    if (l.state !== "ok" && l.state !== "directory") {
      problems.push(`${l.harness}_${l.kind}_${l.state}`);
    }
  }
  for (const h of harnesses) {
    if (h.installed && h.distDirty) problems.push(`dist_dirty_${h.distId}`);
  }
  if (!fs.existsSync(templatePath(cfg, "base")) && templates.length === 0) {
    problems.push("templates_missing");
  }

  let skeletonVersion = null;
  try {
    skeletonVersion = Number(
      fs.readFileSync(path.join(cfg.dir, ".ai-md-skeleton-version"), "utf8").trim()
    );
  } catch {
    /* none */
  }
  if (skeletonVersion != null && skeletonVersion < SKELETON_VERSION) {
    problems.push("skeleton_outdated");
  }

  return {
    generatedAt: new Date().toISOString(),
    dir: cfg.dir,
    remote: remote || cfg.remote || null,
    configuredRemote: cfg.remote || null,
    gitRemote: remote,
    sources: cfg.sources,
    remoteDetection: cfg.remoteDetection,
    linkMode: cfg.linkMode,
    wsl: isWsl(),
    machineConfigPath: cfg.machineConfigPath,
    machineConfig: cfg.machineConfig,
    branch,
    dirty,
    statusLine: aheadBehind,
    layout: {
      shared: { rules: shared.rules, skills: shared.skills },
      agents: cfg.agentsDir,
      dist: cfg.distDir,
      templates: cfg.templatesDir,
      projects: cfg.projectsDir,
    },
    migration,
    counts: {
      rules: countRules(shared.rules),
      skills: countSkills(shared.skills),
      templates: templates.length,
      projects: projects.length,
      drifting: drifting.length,
      problems: problems.length,
    },
    harnesses,
    skipped,
    warnings,
    links: links.map((l) => ({
      harness: l.harness,
      kind: l.kind,
      path: l.path,
      state: l.state,
      ...(full ? { target: l.target, expected: l.expected } : {}),
    })),
    templates,
    projects,
    driftFrom: from,
    skeletonVersion,
    packageSkeletonVersion: SKELETON_VERSION,
    problems,
  };
}

function statusHelp(data) {
  const help = [];
  if (data.problems.includes("ai_md_missing") || data.problems.includes("ai_md_not_git")) {
    help.push(
      "Run `ai-md init` (no remote) or `ai-md setup --remote <git-url>`"
    );
  }
  if (data.problems.includes("legacy_flat_layout")) {
    help.push(
      "Migrate flat rules/skills into shared/ (and agents/<id>/); see package README"
    );
  }
  if (!data.machineConfig) {
    help.push(
      "Persist remote/dir with `ai-md setup --remote <url>` or `ai-md config set --remote <url> --dir ~/.ai-md`"
    );
  }
  if (data.links.some((l) => l.state !== "ok" && l.state !== "directory")) {
    help.push("Run `ai-md doctor --fix` to rebuild dist and repair links");
  }
  if (data.problems.some((p) => p.startsWith("dist_dirty_"))) {
    help.push("Run `ai-md rescue --agents <id>` or `ai-md build --force`");
  }
  if (data.problems.includes("skeleton_outdated")) {
    help.push("Run `ai-md seed-skeleton` to add new recommended files");
  }
  if (data.wsl) {
    help.push(
      "WSL detected: use Windows ai-md for Windows Cursor (homes differ)"
    );
  }
  if (data.skipped && data.skipped.some((s) => s.reason === "not_installed")) {
    help.push(
      "Some harnesses skipped (AI not installed). Install the tool or use --force-link"
    );
  }
  if (data.problems.includes("templates_missing")) {
    help.push("Run `ai-md seed-skeleton` or add templates/base");
  }
  if (data.counts.drifting > 0) {
    help.push(
      `Run \`ai-md apply-template --project <name> --from ${data.driftFrom || "base"}\``
    );
  }
  if (data.dirty) {
    help.push('Run `ai-md push -m "<why>"` to commit and push');
  } else {
    help.push("Edit shared/ or agents/<id>/ only; then `ai-md build`");
  }
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
