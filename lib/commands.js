"use strict";

const fs = require("fs");
const path = require("path");
const {
  resolveConfig,
  templatePath,
  writeMachineConfig,
  gitClone,
  gitPull,
  gitPush,
} = require("./config");
const { collectStatus, statusHelp, collectProjects } = require("./status");
const { linkPath, ensureDir, wslWarnings, defaultLinkMode } = require("./link");
const { runBuild, distRoot, distDirty } = require("./build");
const { runRescue } = require("./rescue");
const {
  selectHarnesses,
  resolveHarness,
  listBuiltinIds,
  getBuiltin,
  ensureAgentSourceDirs,
  isHarnessInstalled,
} = require("./harnesses");
const { seedSkeleton, initRepo, SKELETON_VERSION, isEmptyDir } = require("./skeleton");

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

function initProject({
  repo,
  name,
  from = "base",
  force = false,
  dryRun = false,
} = {}) {
  const cfg = resolveConfig();
  if (!fs.existsSync(path.join(cfg.dir, ".git")) && !fs.existsSync(cfg.dir)) {
    const err = new Error(`${cfg.dir} missing; run ai-md init or ai-md install first`);
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
  actions.push(
    linkPath(projectDir, link, {
      force,
      dryRun,
      linkMode: cfg.linkMode,
    })
  );
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
    linkPath(projectDir, path.join(absRepo, ".cursor"), {
      force,
      dryRun,
      linkMode: cfg.linkMode,
    }),
    ensureGitignore(absRepo, { dryRun }),
  ];
  return { project: projectName, projectDir, repo: absRepo, actions };
}

/** Link dist/<id> → live harness paths. Only for installed harnesses. */
function linkHarnesses(cfg, agents, opts = {}) {
  const {
    force = false,
    dryRun = false,
    forceLink = false,
  } = opts;
  const { selected, skipped, warnings } = selectHarnesses(cfg, agents, {
    forceLink,
  });
  const links = [];
  const platformWarn = wslWarnings(cfg, selected);

  const linkedDist = new Set();
  for (const h of selected) {
    if (linkedDist.has(h.distId)) continue;
    linkedDist.add(h.distId);
    const dist = distRoot(cfg, h.distId);
    if (!fs.existsSync(dist)) {
      links.push({
        harness: h.id,
        action: "skip",
        reason: "dist_missing",
        help: "Run ai-md build first",
      });
      continue;
    }
    if (h.skills) {
      links.push({
        harness: h.id,
        kind: "skills",
        ...linkPath(path.join(dist, "skills"), h.skills, {
          force,
          dryRun,
          linkMode: cfg.linkMode,
        }),
      });
    }
    if (h.rules && h.format !== "skills-only") {
      links.push({
        harness: h.id,
        kind: "rules",
        ...linkPath(path.join(dist, "rules"), h.rules, {
          force,
          dryRun,
          linkMode: cfg.linkMode,
        }),
      });
    }
  }

  return {
    links,
    skipped,
    warnings: [...warnings, ...platformWarn],
  };
}

function buildAndLink(cfg, opts = {}) {
  const build = runBuild(cfg, opts);
  const link = linkHarnesses(cfg, opts.agents, opts);
  return { build, link };
}

function runInstall(cfg, opts = {}) {
  const dir = cfg.dir;
  const empty = !fs.existsSync(dir) || isEmptyDir(dir);

  if (empty) {
    if (!cfg.remote) {
      const err = new Error(
        "No remote configured and content dir is empty.\n" +
          "  ai-md init                 # skeleton only (no remote)\n" +
          "  ai-md setup --remote <url> # clone existing github.com/<user>/.ai-md"
      );
      err.code = "EINVAL";
      throw err;
    }
    if (fs.existsSync(dir) && isEmptyDir(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    gitClone(cfg.remote, dir, { dryRun: opts.dryRun });
    if (!opts.dryRun) {
      seedSkeleton(cfg, { force: false });
    }
  } else if (!fs.existsSync(path.join(dir, ".git"))) {
    const err = new Error(
      `${dir} exists but is not a git repo. Move it aside, then: ai-md setup --remote <url>`
    );
    err.code = "EEXIST";
    throw err;
  } else if (cfg.remote && opts.pull !== false) {
    try {
      gitPull(cfg.dir, { dryRun: opts.dryRun });
    } catch {
      /* offline / no upstream — continue with local tree */
    }
  }

  return buildAndLink(cfg, {
    agents: opts.agents,
    force: opts.force,
    dryRun: opts.dryRun,
    forceLink: opts.forceLink,
  });
}

/**
 * Bootstrap: remote set → clone/sync first (never skeleton-first).
 * No remote → seed skeleton only.
 */
function bootstrapContent(cfg, opts = {}) {
  const {
    noGit = false,
    force = false,
    dryRun = false,
    forceLink = false,
    agents = ["cursor"],
  } = opts;

  if (cfg.remote) {
    const dir = cfg.dir;
    const exists = fs.existsSync(dir);
    const empty = !exists || isEmptyDir(dir);
    const isGit = exists && fs.existsSync(path.join(dir, ".git"));

    if (!empty && isGit) {
      if (!dryRun) {
        writeMachineConfig({
          dir: cfg.dir,
          remote: cfg.remote,
          agents,
          linkMode: cfg.linkMode,
        });
      }
      return {
        action: "synced",
        remote: cfg.remote,
        dir,
        ...runInstall(cfg, {
          agents,
          force,
          dryRun,
          forceLink,
          pull: true,
        }),
      };
    }

    if (!empty && !isGit) {
      if (!force) {
        const err = new Error(
          `${dir} is not empty and has no .git.\n` +
            `  mv ${dir} ${dir}.bak && ai-md setup --remote ${cfg.remote}\n` +
            `  (refusing to seed skeleton before sync when a remote is set)`
        );
        err.code = "EEXIST";
        throw err;
      }
      if (dryRun) {
        return { action: "would_replace_and_clone", remote: cfg.remote, dir };
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }

    if (dryRun) {
      return { action: "would_clone", remote: cfg.remote, dir };
    }
    if (fs.existsSync(dir) && isEmptyDir(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    gitClone(cfg.remote, dir, { dryRun: false });
    // After clone only — fill gaps; never invent a tree instead of syncing
    seedSkeleton(cfg, { force: false });
    writeMachineConfig({
      dir: cfg.dir,
      remote: cfg.remote,
      agents,
      linkMode: cfg.linkMode,
    });
    const fresh = resolveConfig(process.env, {
      dir: cfg.dir,
      remote: cfg.remote,
      skipRemoteDetect: true,
    });
    return {
      action: "cloned",
      remote: cfg.remote,
      dir,
      ...buildAndLink(fresh, { agents, force: true, forceLink }),
    };
  }

  const data = initRepo(cfg, { noGit, force, dryRun });
  if (!dryRun) {
    writeMachineConfig({
      dir: cfg.dir,
      agents,
      linkMode: cfg.linkMode,
    });
  }
  const fresh = resolveConfig(process.env, {
    dir: cfg.dir,
    skipRemoteDetect: true,
  });
  let bl = null;
  if (!dryRun) {
    bl = buildAndLink(fresh, { agents, force: true, forceLink });
  }
  return { action: "initialized", init: data, buildLink: bl };
}

function runPull(cfg, opts = {}) {
  if (!fs.existsSync(path.join(cfg.dir, ".git"))) {
    const err = new Error(`${cfg.dir} is not a git repo; run ai-md install`);
    err.code = "ENOENT";
    throw err;
  }
  gitPull(cfg.dir, { dryRun: opts.dryRun });
  return buildAndLink(cfg, {
    agents: opts.agents,
    force: opts.force,
    dryRun: opts.dryRun,
    forceLink: opts.forceLink,
  });
}

function runPush(cfg, opts = {}) {
  return gitPush(cfg.dir, {
    message: opts.message,
    dryRun: opts.dryRun,
  });
}

function runDoctor({
  fix = false,
  force = false,
  agents = ["cursor"],
  dryRun = false,
  forceLink = false,
} = {}) {
  const cfg = resolveConfig();
  const status = collectStatus({ full: true, agents });
  const repairs = [];
  if (fix || force) {
    try {
      const bl = buildAndLink(cfg, {
        agents,
        force: true,
        dryRun,
        forceLink,
      });
      repairs.push(bl);
    } catch (e) {
      repairs.push({ error: e.message, code: e.code, dirty: e.dirty });
    }
  }
  const after = fix || force ? collectStatus({ full: true, agents }) : status;
  return {
    before: { problems: status.problems, counts: status.counts },
    repairs,
    after: {
      problems: after.problems,
      counts: after.counts,
      links: after.links,
      harnesses: after.harnesses,
      projects: after.projects,
    },
    help: statusHelp(after),
    wsl: wslWarnings(cfg, []),
  };
}

function harnessList(cfg) {
  const ids = new Set([
    ...listBuiltinIds(),
    ...Object.keys((cfg.machineConfig && cfg.machineConfig.harnesses) || {}),
  ]);
  return [...ids].sort().map((id) => {
    const def = resolveHarness(id, cfg);
    return {
      id: def.id,
      format: def.format,
      emitter: def.emitter,
      aliasOf: def.aliasOf,
      skills: def.skills,
      rules: def.rules,
      enabled: def.enabled,
      installed: isHarnessInstalled(def),
      distId: def.distId,
      tier: def.tier,
    };
  });
}

function harnessShow(cfg, id) {
  const def = resolveHarness(id, cfg);
  return {
    ...def,
    installed: isHarnessInstalled(def),
    builtin: Boolean(getBuiltin(id)),
  };
}

function harnessSet(cfg, id, { skills, rules, format } = {}) {
  const key = String(id).toLowerCase();
  const existing = { ...(cfg.machineConfig || {}) };
  const harnesses = { ...(existing.harnesses || {}) };
  const cur = { ...(harnesses[key] || {}) };
  if (skills != null) cur.skills = skills;
  if (rules != null) cur.rules = rules;
  if (format != null) cur.format = format;
  cur.enabled = cur.enabled !== false;
  harnesses[key] = cur;
  const agents = existing.agents || ["cursor"];
  if (!agents.includes(key) && key !== "codex") {
    agents.push(key);
  }
  const saved = writeMachineConfig({ ...existing, harnesses, agents });
  ensureAgentSourceDirs(
    { ...cfg, dir: saved.config.dir || cfg.dir },
    key === "codex" ? "agents" : key
  );
  return { id: key, harness: cur, config: saved };
}

function harnessUnset(cfg, id, { pathsOnly = false } = {}) {
  const key = String(id).toLowerCase();
  const existing = { ...(cfg.machineConfig || {}) };
  const harnesses = { ...(existing.harnesses || {}) };
  if (pathsOnly && harnesses[key]) {
    delete harnesses[key].skills;
    delete harnesses[key].rules;
    delete harnesses[key].format;
  } else {
    delete harnesses[key];
  }
  return writeMachineConfig({ ...existing, harnesses });
}

function harnessEnable(cfg, id, enabled) {
  const key = String(id).toLowerCase();
  const existing = { ...(cfg.machineConfig || {}) };
  const harnesses = { ...(existing.harnesses || {}) };
  harnesses[key] = { ...(harnesses[key] || {}), enabled };
  let agents = [...(existing.agents || ["cursor"])];
  if (enabled && !agents.includes(key) && key !== "codex") agents.push(key);
  if (!enabled) agents = agents.filter((a) => a !== key);
  return writeMachineConfig({ ...existing, harnesses, agents });
}

// legacy exports expected by older callers
function ensureCursorLinks(cfg, opts = {}) {
  return linkHarnesses(cfg, ["cursor"], opts).links;
}

function ensureAgentSkillLinks(cfg, agents, opts = {}) {
  return linkHarnesses(cfg, agents, opts).links;
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
  linkHarnesses,
  buildAndLink,
  runInstall,
  runPull,
  runPush,
  runBuild,
  runRescue,
  seedSkeleton,
  initRepo,
  bootstrapContent,
  harnessList,
  harnessShow,
  harnessSet,
  harnessUnset,
  harnessEnable,
  collectProjects,
  SKELETON_VERSION,
  distDirty,
  defaultLinkMode,
};
