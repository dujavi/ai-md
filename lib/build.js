"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ensureDir, fingerprintTree, walkFiles, hashFile } = require("./link");
const { selectHarnesses, ensureAgentSourceDirs } = require("./harnesses");

function sharedRoots(cfg) {
  return {
    rules: path.join(cfg.dir, "shared", "rules"),
    skills: path.join(cfg.dir, "shared", "skills"),
  };
}

function agentRoots(cfg, id) {
  const srcId = id === "codex" ? "agents" : id;
  return {
    rules: path.join(cfg.dir, "agents", srcId, "rules"),
    skills: path.join(cfg.dir, "agents", srcId, "skills"),
  };
}

function distRoot(cfg, distId) {
  return path.join(cfg.dir, "dist", distId);
}

function listRuleFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mdc") || f.endsWith(".md"))
    .sort();
}

function listSkillDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true });
}

/** Merge shared then agent; agent wins on basename. */
function mergeRules(sharedDir, agentDir, format) {
  const map = new Map(); // basename without forcing ext
  for (const f of listRuleFiles(sharedDir)) {
    map.set(f.replace(/\.(mdc|md)$/i, ""), {
      src: path.join(sharedDir, f),
      name: f,
      layer: "shared",
    });
  }
  for (const f of listRuleFiles(agentDir)) {
    const key = f.replace(/\.(mdc|md)$/i, "");
    map.set(key, {
      src: path.join(agentDir, f),
      name: f,
      layer: "agent",
    });
  }
  const out = [];
  for (const [, ent] of map) {
    let destName = ent.name;
    if (format === "md" && destName.endsWith(".mdc")) {
      destName = destName.slice(0, -4) + ".md";
    } else if (format === "mdc" && destName.endsWith(".md") && !destName.endsWith(".mdc")) {
      // keep .md as-is for mdc harness if already md; cursor prefers .mdc
      if (!destName.endsWith(".mdc")) destName = destName.replace(/\.md$/i, ".mdc");
    }
    out.push({ ...ent, destName });
  }
  return out;
}

function mergeSkills(sharedDir, agentDir) {
  const map = new Map();
  for (const name of listSkillDirs(sharedDir)) {
    map.set(name, { src: path.join(sharedDir, name), layer: "shared" });
  }
  for (const name of listSkillDirs(agentDir)) {
    map.set(name, { src: path.join(agentDir, name), layer: "agent" });
  }
  return [...map.entries()].map(([name, v]) => ({ name, ...v }));
}

function readManifest(distDir) {
  const p = path.join(distDir, ".build-manifest.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function distDirty(distDir) {
  const manifest = readManifest(distDir);
  if (!manifest || !manifest.files) {
    if (!fs.existsSync(distDir)) return { dirty: false, files: [] };
    // no manifest but files exist
    const files = walkFiles(distDir);
    return {
      dirty: files.length > 0,
      files: files.map((f) => f.rel),
      reason: "missing_manifest",
    };
  }
  const current = fingerprintTree(distDir);
  const dirtyFiles = [];
  for (const [rel, hash] of Object.entries(manifest.files)) {
    if (current[rel] !== hash) dirtyFiles.push(rel);
  }
  for (const rel of Object.keys(current)) {
    if (!manifest.files[rel]) dirtyFiles.push(rel);
  }
  return { dirty: dirtyFiles.length > 0, files: dirtyFiles, reason: "drift" };
}

function emitHarness(cfg, harness, { dryRun = false, verbose = false } = {}) {
  const distId = harness.distId;
  const outDir = distRoot(cfg, distId);
  const shared = sharedRoots(cfg);
  const agent = agentRoots(cfg, harness.id);
  ensureAgentSourceDirs(cfg, harness.id);

  const overrides = [];
  const rules =
    harness.format === "skills-only"
      ? []
      : mergeRules(shared.rules, agent.rules, harness.format);
  const skills = mergeSkills(shared.skills, agent.skills);

  for (const r of rules) {
    if (r.layer === "agent") overrides.push(`rules/${r.destName}`);
  }
  for (const s of skills) {
    if (s.layer === "agent") overrides.push(`skills/${s.name}`);
  }

  if (dryRun) {
    return {
      id: harness.id,
      distId,
      action: "would_build",
      rules: rules.length,
      skills: skills.length,
      overrides: verbose ? overrides : overrides.length,
      outDir,
    };
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  ensureDir(path.join(outDir, "skills"));
  if (harness.format !== "skills-only") ensureDir(path.join(outDir, "rules"));

  for (const r of rules) {
    copyFile(r.src, path.join(outDir, "rules", r.destName));
  }
  for (const s of skills) {
    copyDir(s.src, path.join(outDir, "skills", s.name));
  }

  const files = fingerprintTree(outDir);
  const manifest = {
    version: 1,
    harness: harness.id,
    distId,
    format: harness.format,
    builtAt: new Date().toISOString(),
    inputsHash: crypto
      .createHash("sha256")
      .update(JSON.stringify({ rules, skills: skills.map((s) => s.name) }))
      .digest("hex"),
    files,
    overrides,
  };
  fs.writeFileSync(
    path.join(outDir, ".build-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );

  return {
    id: harness.id,
    distId,
    action: "built",
    rules: rules.length,
    skills: skills.length,
    overrides: verbose ? overrides : overrides.length,
    outDir,
  };
}

/**
 * Build dist for selected harnesses. Refuses if dirty unless force.
 */
function runBuild(cfg, opts = {}) {
  const {
    agents,
    force = false,
    dryRun = false,
    verbose = false,
    forceLink = false,
    includeUninstalled = false,
  } = opts;

  const { selected, skipped, warnings } = selectHarnesses(cfg, agents, {
    forceLink,
    includeUninstalled,
  });

  // Deduplicate by distId for emit
  const byDist = new Map();
  for (const h of selected) {
    if (!byDist.has(h.distId)) byDist.set(h.distId, h);
  }

  const dirtyBlocks = [];
  for (const [distId] of byDist) {
    const d = distDirty(distRoot(cfg, distId));
    if (d.dirty && !force) {
      dirtyBlocks.push({ distId, ...d });
    }
  }

  if (dirtyBlocks.length && !dryRun) {
    const err = new Error(
      `dist has edits not in source (${dirtyBlocks.map((d) => d.distId).join(", ")}). ` +
        `Run: ai-md rescue --agents <id>   or   ai-md build --force`
    );
    err.code = "EDIRTY";
    err.dirty = dirtyBlocks;
    throw err;
  }

  const results = [];
  for (const h of byDist.values()) {
    results.push(emitHarness(cfg, h, { dryRun, verbose }));
  }

  return {
    built: results,
    skipped,
    warnings,
    dirtyForced: force ? dirtyBlocks : [],
  };
}

module.exports = {
  sharedRoots,
  agentRoots,
  distRoot,
  mergeRules,
  mergeSkills,
  distDirty,
  readManifest,
  runBuild,
  emitHarness,
};
