"use strict";

const fs = require("fs");
const path = require("path");
const {
  resolveConfig,
  templatePath,
  symlinkState,
  agentSkillTargets,
} = require("./config");
const { collectStatus, statusHelp, collectProjects } = require("./status");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function linkPath(target, link, { force = false, dryRun = false } = {}) {
  ensureDir(path.dirname(link));
  ensureDir(target);
  const state = symlinkState(link, target);
  if (state.state === "ok") {
    return { path: link, action: "ok", target };
  }
  if (state.state === "not_symlink" && !force) {
    const err = new Error(
      `${link} exists and is not a symlink (use --force to replace)`
    );
    err.code = "EEXIST";
    throw err;
  }
  if (dryRun) {
    return { path: link, action: state.state === "missing" ? "would_link" : "would_repair", target };
  }
  if (fs.existsSync(link) || state.state !== "missing") {
    try {
      fs.lstatSync(link);
      fs.rmSync(link, { recursive: true, force: true });
    } catch {
      /* missing */
    }
  }
  fs.symlinkSync(target, link);
  return {
    path: link,
    action: state.state === "missing" ? "linked" : "repaired",
    target,
  };
}

function ensureCursorLinks(cfg, opts = {}) {
  return [
    linkPath(cfg.skillsDir, cfg.cursorSkills, opts),
    linkPath(cfg.rulesDir, cfg.cursorRules, opts),
  ];
}

function ensureAgentSkillLinks(cfg, agents, opts = {}) {
  return agentSkillTargets(cfg.home, agents)
    .filter((t) => t.name !== "cursor") // cursor handled via ensureCursorLinks
    .map((t) => linkPath(cfg.skillsDir, t.path, opts));
}

function ensureGitignore(repoPath, { dryRun = false } = {}) {
  const gitignore = path.join(repoPath, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    return { path: gitignore, action: "missing_gitignore" };
  }
  const text = fs.readFileSync(gitignore, "utf8");
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => l.trim() === ".cursor/")) {
    return { path: gitignore, action: "ok" };
  }
  if (dryRun) return { path: gitignore, action: "would_append" };
  const suffix =
    (text.endsWith("\n") || text.length === 0 ? "" : "\n") +
    "\n# Personal Cursor config (symlink to ~/.ai-md)\n.cursor/\n";
  fs.appendFileSync(gitignore, suffix);
  return { path: gitignore, action: "appended" };
}

function copyDir(src, dest, { dryRun = false } = {}) {
  if (dryRun) return { action: "would_copy", from: src, to: dest };
  fs.cpSync(src, dest, { recursive: true, force: false, errorOnExist: false });
  return { action: "copied", from: src, to: dest };
}

function initProject({
  repo,
  name,
  from = "base",
  force = false,
  dryRun = false,
} = {}) {
  const cfg = resolveConfig();
  if (!fs.existsSync(path.join(cfg.dir, ".git"))) {
    const err = new Error(`${cfg.dir} is not a git repo; run ai-md install first`);
    err.code = "ENOENT";
    throw err;
  }
  if (!repo || !fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) {
    const err = new Error(`missing or invalid --repo <path>`);
    err.code = "EINVAL";
    throw err;
  }
  const absRepo = fs.realpathSync(repo);
  const projectName = name || path.basename(absRepo);
  const tmplDir = templatePath(cfg, from);
  const projectDir = path.join(cfg.projectsDir, projectName);

  if (!fs.existsSync(tmplDir)) {
    const err = new Error(
      `template not found: ${tmplDir} (available under ${cfg.templatesDir}/)`
    );
    err.code = "ENOENT";
    throw err;
  }

  const actions = [];
  if (fs.existsSync(projectDir)) {
    const hasContent =
      countEntries(path.join(projectDir, "rules")) +
        countEntries(path.join(projectDir, "skills")) >
      0;
    if (hasContent && !force) {
      actions.push({ action: "exists", path: projectDir });
    } else {
      actions.push(...mergeTemplate(tmplDir, projectDir, { dryRun }));
    }
  } else {
    actions.push(copyDir(tmplDir, projectDir, { dryRun }));
  }

  const link = path.join(absRepo, ".cursor");
  actions.push(linkPath(projectDir, link, { force, dryRun }));
  actions.push(ensureGitignore(absRepo, { dryRun }));

  return {
    project: projectName,
    projectDir,
    repo: absRepo,
    from,
    templateDir: tmplDir,
    actions,
  };
}

function countEntries(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((n) => !n.startsWith(".")).length;
}

function mergeTemplate(templateDir, projectDir, { dryRun = false } = {}) {
  const actions = [];
  for (const kind of ["rules", "skills"]) {
    const srcRoot = path.join(templateDir, kind);
    const destRoot = path.join(projectDir, kind);
    if (!fs.existsSync(srcRoot)) continue;
    ensureDir(destRoot);
    for (const name of fs.readdirSync(srcRoot)) {
      if (name.startsWith(".")) continue;
      const src = path.join(srcRoot, name);
      const dest = path.join(destRoot, name);
      if (fs.existsSync(dest)) {
        actions.push({ action: "keep", path: dest });
        continue;
      }
      if (dryRun) {
        actions.push({ action: "would_add", path: dest, from: src });
      } else {
        fs.cpSync(src, dest, { recursive: true });
        actions.push({ action: "added", path: dest, from: src });
      }
    }
  }
  return actions;
}

function applyTemplate({ project, from = "base", dryRun = false } = {}) {
  const cfg = resolveConfig();
  if (!project) {
    const err = new Error("missing --project <name>");
    err.code = "EINVAL";
    throw err;
  }
  const projectDir = path.join(cfg.projectsDir, project);
  if (!fs.existsSync(projectDir)) {
    const err = new Error(`project not found: ${projectDir}`);
    err.code = "ENOENT";
    throw err;
  }
  const tmplDir = templatePath(cfg, from);
  if (!fs.existsSync(tmplDir)) {
    const err = new Error(`template not found: ${tmplDir}`);
    err.code = "ENOENT";
    throw err;
  }
  const actions = mergeTemplate(tmplDir, projectDir, { dryRun });
  return { project, projectDir, from, templateDir: tmplDir, actions };
}

function linkProject({ repo, name, force = false, dryRun = false } = {}) {
  const cfg = resolveConfig();
  if (!fs.existsSync(path.join(cfg.dir, ".git"))) {
    const err = new Error(`${cfg.dir} is not a git repo; run ai-md install first`);
    err.code = "ENOENT";
    throw err;
  }
  if (!repo || !fs.existsSync(repo)) {
    const err = new Error("missing or invalid --repo <path>");
    err.code = "EINVAL";
    throw err;
  }
  const absRepo = fs.realpathSync(repo);
  const projectName = name || path.basename(absRepo);
  const projectDir = path.join(cfg.projectsDir, projectName);
  if (!dryRun) {
    ensureDir(path.join(projectDir, "rules"));
    ensureDir(path.join(projectDir, "skills"));
  }
  const actions = [
    linkPath(projectDir, path.join(absRepo, ".cursor"), { force, dryRun }),
    ensureGitignore(absRepo, { dryRun }),
  ];
  return { project: projectName, projectDir, repo: absRepo, actions };
}

function runDoctor({ fix = false, force = false, agents = ["cursor"], dryRun = false } = {}) {
  const cfg = resolveConfig();
  const status = collectStatus({ full: true, agents });
  const repairs = [];
  if (fix || force) {
    repairs.push(...ensureCursorLinks(cfg, { force: true, dryRun }));
    repairs.push(...ensureAgentSkillLinks(cfg, agents, { force: true, dryRun }));
  }
  const after = fix || force ? collectStatus({ full: true, agents }) : status;
  return {
    before: {
      problems: status.problems,
      counts: status.counts,
    },
    repairs,
    after: {
      problems: after.problems,
      counts: after.counts,
      links: after.links,
      projects: after.projects,
    },
    help: statusHelp(after),
  };
}

module.exports = {
  ensureCursorLinks,
  ensureAgentSkillLinks,
  ensureGitignore,
  initProject,
  applyTemplate,
  linkProject,
  runDoctor,
  linkPath,
  collectProjects,
};
