"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  defaultLinkMode,
  isWsl,
  looksLikeWindowsPath,
  pathsEqual,
  normalizePath,
} = require("./config-paths");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function linkState(linkPath, expected) {
  let stat;
  try {
    stat = fs.lstatSync(linkPath);
  } catch {
    return { path: linkPath, state: "missing", target: null, expected };
  }
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(linkPath);
    const absTarget = path.isAbsolute(target)
      ? target
      : path.resolve(path.dirname(linkPath), target);
    if (pathsEqual(absTarget, expected) || target === expected) {
      return { path: linkPath, state: "ok", target, expected, mode: "symlink" };
    }
    return {
      path: linkPath,
      state: "wrong_target",
      target,
      expected,
      mode: "symlink",
    };
  }
  if (stat.isDirectory()) {
    return {
      path: linkPath,
      state: "directory",
      target: null,
      expected,
      mode: "copy_or_real",
    };
  }
  return { path: linkPath, state: "not_symlink", target: null, expected };
}

function trySymlink(target, link, type) {
  fs.symlinkSync(target, link, type);
}

/**
 * Platform-aware directory link: symlink | junction | copy
 */
function linkPath(
  target,
  link,
  { force = false, dryRun = false, linkMode = null } = {}
) {
  const absTarget = path.resolve(target);
  ensureDir(path.dirname(link));
  ensureDir(absTarget);

  const mode = linkMode || defaultLinkMode();
  const state = linkState(link, absTarget);

  if (mode !== "copy" && state.state === "ok") {
    return { path: link, action: "ok", target: absTarget, mode };
  }

  if (state.state === "directory" && mode !== "copy" && !force) {
    const err = new Error(
      `${link} exists as a real directory (use --force to replace, or --link-mode copy)`
    );
    err.code = "EEXIST";
    throw err;
  }

  if (state.state === "not_symlink" && !force && mode !== "copy") {
    const err = new Error(
      `${link} exists and is not a symlink (use --force to replace)`
    );
    err.code = "EEXIST";
    throw err;
  }

  if (dryRun) {
    return {
      path: link,
      action: state.state === "missing" ? "would_link" : "would_repair",
      target: absTarget,
      mode,
    };
  }

  if (mode === "copy") {
    return syncCopyTree(absTarget, link, { force });
  }

  if (fs.existsSync(link) || state.state !== "missing") {
    try {
      fs.rmSync(link, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  const attempts =
    process.platform === "win32"
      ? mode === "junction"
        ? ["junction", "dir"]
        : [mode === "symlink" ? "dir" : mode, "junction"]
      : ["dir"];

  let lastErr = null;
  for (const t of attempts) {
    try {
      trySymlink(absTarget, link, t);
      return {
        path: link,
        action: state.state === "missing" ? "linked" : "repaired",
        target: absTarget,
        mode: t === "junction" ? "junction" : "symlink",
      };
    } catch (e) {
      lastErr = e;
    }
  }

  // Fallback to copy
  const copied = syncCopyTree(absTarget, link, { force: true });
  return {
    ...copied,
    warning: `symlink failed (${lastErr && lastErr.message}); used copy`,
    mode: "copy",
  };
}

function syncCopyTree(src, dest, { force = false } = {}) {
  ensureDir(dest);
  // Remove dest contents that aren't in src
  if (fs.existsSync(dest)) {
    for (const name of fs.readdirSync(dest)) {
      if (name === ".ai-md-copy-marker") continue;
      const s = path.join(src, name);
      const d = path.join(dest, name);
      if (!fs.existsSync(s)) {
        fs.rmSync(d, { recursive: true, force: true });
      }
    }
  }
  fs.cpSync(src, dest, { recursive: true, force: true });
  fs.writeFileSync(
    path.join(dest, ".ai-md-copy-marker"),
    JSON.stringify({ src: normalizePath(src), at: new Date().toISOString() }) +
      "\n"
  );
  return { path: dest, action: "copied", target: src, mode: "copy" };
}

function wslWarnings(cfg, harnessDefs) {
  const warnings = [];
  if (!isWsl()) return warnings;
  warnings.push(
    "Running under WSL: run ai-md in the same environment as the IDE/CLI that consumes links (Windows Cursor needs Windows ai-md)."
  );
  for (const h of harnessDefs || []) {
    for (const p of [h.skills, h.rules]) {
      if (p && looksLikeWindowsPath(p)) {
        warnings.push(
          `Harness ${h.id} path looks Windows-native under WSL: ${p}`
        );
      }
    }
  }
  return warnings;
}

function hashFile(filePath) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(filePath));
  return h.digest("hex");
}

function walkFiles(root, base = root, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (ent.name === ".build-manifest.json" || ent.name === ".ai-md-copy-marker") {
      continue;
    }
    if (ent.name.startsWith(".") && ent.isDirectory()) continue;
    const full = path.join(root, ent.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (ent.isDirectory()) walkFiles(full, base, out);
    else if (ent.isFile()) out.push({ rel, full });
  }
  return out;
}

function fingerprintTree(root) {
  const files = walkFiles(root);
  const map = {};
  for (const f of files) {
    map[f.rel] = hashFile(f.full);
  }
  return map;
}

module.exports = {
  ensureDir,
  linkPath,
  linkState,
  syncCopyTree,
  wslWarnings,
  fingerprintTree,
  walkFiles,
  hashFile,
  defaultLinkMode,
};
