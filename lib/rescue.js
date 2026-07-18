"use strict";

const fs = require("fs");
const path = require("path");
const { distRoot, distDirty, agentRoots } = require("./build");
const { selectHarnesses, ensureAgentSourceDirs } = require("./harnesses");
const { ensureDir, walkFiles, hashFile } = require("./link");
const { readManifest } = require("./build");

/**
 * Promote dirty dist files into agents/<id>/ (not shared/).
 */
function runRescue(cfg, opts = {}) {
  const { agents, dryRun = false, forceLink = false } = opts;
  const { selected, skipped, warnings } = selectHarnesses(cfg, agents, {
    forceLink: true,
    includeUninstalled: true,
  });

  const actions = [];
  const byDist = new Map();
  for (const h of selected) {
    if (!byDist.has(h.distId)) byDist.set(h.distId, h);
  }

  for (const h of byDist.values()) {
    const distDir = distRoot(cfg, h.distId);
    const dirty = distDirty(distDir);
    if (!dirty.dirty) {
      actions.push({ id: h.id, distId: h.distId, action: "clean" });
      continue;
    }
    ensureAgentSourceDirs(cfg, h.distId);
    const agent = agentRoots(cfg, h.distId);
    const manifest = readManifest(distDir) || { files: {} };

    for (const rel of dirty.files) {
      const src = path.join(distDir, rel);
      if (!fs.existsSync(src)) continue;
      let dest;
      if (rel.startsWith("rules/")) {
        dest = path.join(agent.rules, path.basename(rel));
      } else if (rel.startsWith("skills/")) {
        // skills/name/...
        const parts = rel.split("/");
        const skillName = parts[1];
        if (!skillName) continue;
        if (parts.length === 2 || fs.statSync(src).isDirectory()) {
          dest = path.join(agent.skills, skillName);
          if (!dryRun) {
            if (fs.statSync(path.join(distDir, "skills", skillName)).isDirectory()) {
              fs.cpSync(path.join(distDir, "skills", skillName), dest, {
                recursive: true,
                force: true,
              });
            }
          }
          actions.push({
            id: h.id,
            action: dryRun ? "would_rescue_skill" : "rescued_skill",
            from: rel,
            to: dest,
          });
          continue;
        }
        dest = path.join(agent.skills, parts.slice(1).join("/"));
      } else {
        continue;
      }
      if (dryRun) {
        actions.push({
          id: h.id,
          action: "would_rescue",
          from: rel,
          to: dest,
        });
      } else {
        ensureDir(path.dirname(dest));
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, dest);
        }
        actions.push({
          id: h.id,
          action: "rescued",
          from: rel,
          to: dest,
        });
      }
    }
  }

  return { actions, skipped, warnings };
}

module.exports = { runRescue };
