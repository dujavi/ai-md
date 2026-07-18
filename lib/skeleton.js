"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ensureDir } = require("./link");

const SKELETON_VERSION = 1;

function packageRoot() {
  return path.join(__dirname, "..");
}

function skeletonRoot() {
  return path.join(packageRoot(), "skeleton");
}

function isEmptyDir(dir) {
  if (!fs.existsSync(dir)) return true;
  const ents = fs.readdirSync(dir).filter((n) => n !== "." && n !== "..");
  return ents.length === 0;
}

function copySkeletonFile(src, dest, { force = false } = {}) {
  if (fs.existsSync(dest) && !force) {
    return { action: "keep", path: dest };
  }
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true, force: true });
  return { action: force ? "replaced" : "added", path: dest };
}

function walkSkeleton(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(base, full);
    if (ent.isDirectory()) walkSkeleton(full, base, out);
    else out.push({ rel, full });
  }
  return out;
}

/**
 * Seed missing skeleton files into cfg.dir (never overwrite unless force).
 */
function seedSkeleton(cfg, { force = false, dryRun = false } = {}) {
  const srcRoot = skeletonRoot();
  if (!fs.existsSync(srcRoot)) {
    const err = new Error(`skeleton missing in package: ${srcRoot}`);
    err.code = "ENOENT";
    throw err;
  }
  const actions = [];
  for (const f of walkSkeleton(srcRoot)) {
    const dest = path.join(cfg.dir, f.rel);
    if (dryRun) {
      actions.push({
        action: fs.existsSync(dest) && !force ? "would_keep" : "would_add",
        path: dest,
      });
      continue;
    }
    actions.push(copySkeletonFile(f.full, dest, { force }));
  }
  // ensure agent dir structure
  for (const id of ["cursor", "claude", "agents", "gemini", "opencode"]) {
    const r = path.join(cfg.dir, "agents", id, "rules");
    const s = path.join(cfg.dir, "agents", id, "skills");
    if (!dryRun) {
      ensureDir(r);
      ensureDir(s);
    }
  }
  const verPath = path.join(cfg.dir, ".ai-md-skeleton-version");
  if (!dryRun) {
    fs.writeFileSync(verPath, String(SKELETON_VERSION) + "\n");
  }
  actions.push({
    action: dryRun ? "would_write_version" : "version",
    path: verPath,
    version: SKELETON_VERSION,
  });
  return { actions, skeletonVersion: SKELETON_VERSION };
}

function initRepo(cfg, { noGit = false, force = false, dryRun = false } = {}) {
  const dir = cfg.dir;
  if (fs.existsSync(dir) && !isEmptyDir(dir) && !force) {
    const err = new Error(
      `${dir} is not empty. Use ai-md seed-skeleton to add missing files, or ai-md init --force`
    );
    err.code = "EEXIST";
    throw err;
  }
  if (dryRun) {
    return { action: "would_init", dir };
  }
  ensureDir(dir);
  if (force && fs.existsSync(dir)) {
    // only remove if force — dangerous; only clear if user asked
    // We do not wipe; seed with force overwrite of skeleton files only
  }
  const seeded = seedSkeleton(cfg, { force: true, dryRun: false });
  if (!noGit && !fs.existsSync(path.join(dir, ".git"))) {
    execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
  }
  return { action: "initialized", dir, ...seeded };
}

module.exports = {
  SKELETON_VERSION,
  skeletonRoot,
  seedSkeleton,
  initRepo,
  isEmptyDir,
};
