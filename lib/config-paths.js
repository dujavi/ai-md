"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function expandHome(p) {
  if (!p) return p;
  let s = String(p);
  if (process.platform === "win32") {
    s = s.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);
  }
  if (s === "~") return os.homedir();
  if (s.startsWith("~/") || s.startsWith("~\\")) {
    return path.join(os.homedir(), s.slice(2));
  }
  return s;
}

function isWsl() {
  if (process.platform !== "linux") return false;
  try {
    const rel = os.release().toLowerCase();
    if (rel.includes("microsoft") || rel.includes("wsl")) return true;
  } catch {
    /* ignore */
  }
  try {
    const v = fs.readFileSync("/proc/version", "utf8").toLowerCase();
    return v.includes("microsoft") || v.includes("wsl");
  } catch {
    return false;
  }
}

function defaultLinkMode() {
  if (process.platform === "win32") return "junction";
  return "symlink";
}

function looksLikeWindowsPath(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

function normalizePath(p) {
  if (!p) return p;
  try {
    return fs.realpathSync.native
      ? fs.realpathSync.native(p)
      : fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function pathsEqual(a, b) {
  if (!a || !b) return false;
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (process.platform === "win32") {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
}

module.exports = {
  expandHome,
  isWsl,
  defaultLinkMode,
  looksLikeWindowsPath,
  normalizePath,
  pathsEqual,
};
