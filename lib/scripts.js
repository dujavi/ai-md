"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function scriptsDir(cfg) {
  return path.join(cfg.dir, "scripts");
}

/**
 * Resolve a private script by basename only (no path separators).
 * Prefers exact name, then `<name>.sh`.
 */
function resolveScript(cfg, name) {
  const raw = String(name || "").trim();
  if (!raw || !NAME_RE.test(raw) || raw.includes("..")) {
    const err = new Error(
      `invalid script name: ${JSON.stringify(name)} (use a single basename)`
    );
    err.code = "EINVAL";
    throw err;
  }

  const dir = scriptsDir(cfg);
  const exact = path.join(dir, raw);
  const withSh = raw.endsWith(".sh") ? null : path.join(dir, `${raw}.sh`);

  if (fs.existsSync(exact) && fs.statSync(exact).isFile()) {
    return { name: raw, path: exact, dir };
  }
  if (withSh && fs.existsSync(withSh) && fs.statSync(withSh).isFile()) {
    return { name: raw, path: withSh, dir };
  }

  const err = new Error(
    `script not found: ${raw} (looked in ${dir}/${raw} and ${dir}/${raw}.sh)`
  );
  err.code = "ENOENT";
  throw err;
}

/**
 * Run a private script with forwarded args. Returns { name, args, path, exitCode }.
 * Uses bash for .sh; otherwise executes the file directly.
 */
function runScript(cfg, name, args = [], { dryRun = false } = {}) {
  const resolved = resolveScript(cfg, name);
  const scriptArgs = Array.isArray(args) ? args.map(String) : [];
  const useBash = resolved.path.endsWith(".sh");
  const argv = useBash
    ? ["bash", resolved.path, ...scriptArgs]
    : [resolved.path, ...scriptArgs];

  if (dryRun) {
    return {
      name: resolved.name,
      args: scriptArgs,
      path: resolved.path,
      exitCode: 0,
      dryRun: true,
      command: argv,
    };
  }

  const result = spawnSync(argv[0], argv.slice(1), {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    const err = new Error(result.error.message);
    err.code = result.error.code || "EEXEC";
    throw err;
  }

  return {
    name: resolved.name,
    args: scriptArgs,
    path: resolved.path,
    exitCode: result.status === null ? 1 : result.status,
  };
}

function runScripts(cfg, names, args = [], { dryRun = false } = {}) {
  const results = [];
  for (const name of names) {
    const result = runScript(cfg, name, args, { dryRun });
    results.push(result);
    if (!dryRun && result.exitCode !== 0) {
      break;
    }
  }
  return results;
}

module.exports = {
  scriptsDir,
  resolveScript,
  runScript,
  runScripts,
};
