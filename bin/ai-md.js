#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const { resolveConfig } = require("../lib/config");
const { emit, fail } = require("../lib/output");
const { collectStatus, statusHelp } = require("../lib/status");
const {
  initProject,
  applyTemplate,
  linkProject,
  runDoctor,
  ensureCursorLinks,
  ensureAgentSkillLinks,
} = require("../lib/commands");

const scriptsDir = path.join(__dirname, "..", "scripts");
const cfg = resolveConfig();

process.env.AI_MD_DIR = cfg.dir;
process.env.AI_MD_REMOTE = cfg.remote;
process.env.CURSOR_MD_DIR = cfg.dir;
process.env.CURSOR_MD_REMOTE = cfg.remote;

function parseArgs(argv) {
  const out = {
    cmd: null,
    json: false,
    full: false,
    force: false,
    dryRun: false,
    fix: false,
    message: null,
    repo: null,
    name: null,
    project: null,
    from: "base",
    agents: ["cursor"],
    rest: [],
  };
  const args = [...argv];
  if (args.length === 0) {
    out.cmd = "status";
    return out;
  }
  const first = args[0];
  if (first === "-h" || first === "--help" || first === "help") {
    out.cmd = "help";
    return out;
  }
  if (first.startsWith("-")) {
    // flags before command → treat as status with flags
    out.cmd = "status";
  } else {
    out.cmd = args.shift();
  }
  while (args.length) {
    const a = args.shift();
    switch (a) {
      case "--json":
        out.json = true;
        break;
      case "--full":
        out.full = true;
        break;
      case "--force":
        out.force = true;
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--fix":
        out.fix = true;
        out.force = true;
        break;
      case "-m":
      case "--message":
        out.message = args.shift();
        break;
      case "--repo":
        out.repo = args.shift();
        break;
      case "--name":
        out.name = args.shift();
        break;
      case "--project":
        out.project = args.shift();
        break;
      case "--from":
        out.from = args.shift();
        break;
      case "--agents":
        out.agents = String(args.shift() || "cursor")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "-h":
      case "--help":
        out.cmdHelp = true;
        break;
      default:
        if (a.startsWith("-")) {
          fail(`unknown flag: ${a}`, {
            exitCode: 2,
            json: out.json,
            help: ["Run `ai-md --help`"],
          });
          process.exit(2);
        }
        out.rest.push(a);
        break;
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`ai-md — private ~/.ai-md: system skills/rules + templates/ + projects/ (AXI-shaped)

Usage:
  ai-md [command] [options]
  npx -y @dujavi/ai-md [command] [options]

Layout:
  ~/.ai-md/skills, rules     System (global) base — linked to ~/.cursor
  ~/.ai-md/templates/<type>  Project-type starters (default: base)
  ~/.ai-md/projects/<name>   Per-app overlays (repo .cursor → here)

Commands:
  status             Snapshot (default when no command) [AXI]
  doctor             Diagnose links/projects; --fix repairs
  install            Clone remote if needed; link ~/.cursor + optional agents
  pull | push        Sync private git repo
  ensure-tools       Install/update grok + quota-axi (alias: tools)
  init-project       Seed projects/<name> from templates/<from> + link .cursor/
  apply-template     Merge missing files from a template into a project
  link-project       Link repo .cursor/ without seeding (alias: link)
  help               Show this help

Options:
  --json             JSON instead of TOON (status/doctor/init/…)
  --full             Include paths and drift details
  --agents <list>    Skill link targets: cursor,claude,agents (default: cursor)
  --repo <path>      App repository root
  --name <id>        Project id under projects/ (default: basename)
  --project <id>     Target project for apply-template
  --from <id>        Template under templates/ (default: base)
  --force            Replace non-symlink .cursor / re-merge
  --dry-run          Preview without writing
  --fix             doctor: repair symlinks
  -m, --message      push commit message

Examples:
  ai-md
  ai-md status --json
  ai-md init-project --repo ~/presenter --from base
  ai-md apply-template --project presenter --from base
  ai-md doctor --fix --agents cursor,claude
`);
}

function runBash(script, args) {
  const result = spawnSync("bash", [path.join(scriptsDir, script), ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    fail(result.error.message, { exitCode: 1 });
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.cmd === "help" || opts.cmdHelp) {
    printHelp();
    return;
  }

  try {
    switch (opts.cmd) {
      case "status": {
        const data = collectStatus({
          full: opts.full,
          agents: opts.agents,
          from: opts.from,
        });
        emit({ data, json: opts.json, help: statusHelp(data) });
        process.exitCode = data.counts.problems > 0 ? 1 : 0;
        break;
      }
      case "doctor": {
        const data = runDoctor({
          fix: opts.fix,
          force: opts.force,
          agents: opts.agents,
          dryRun: opts.dryRun,
        });
        emit({
          data,
          json: opts.json,
          help: data.help,
        });
        process.exitCode = data.after.problems.length > 0 ? 1 : 0;
        break;
      }
      case "init-project": {
        const data = initProject({
          repo: opts.repo,
          name: opts.name,
          from: opts.from,
          force: opts.force,
          dryRun: opts.dryRun,
        });
        emit({
          data,
          json: opts.json,
          help: [
            "Customize rules/agentic-workflow.mdc for this project",
            'Run `ai-md push -m "Init <project>"` after reviewing the private repo diff',
          ],
        });
        break;
      }
      case "apply-template": {
        const data = applyTemplate({
          project: opts.project || opts.name,
          from: opts.from,
          dryRun: opts.dryRun,
        });
        emit({
          data,
          json: opts.json,
          help: [
            "Review added files under ~/.ai-md/projects/<name>/",
            'Run `ai-md push -m "Apply template to <project>"` when ready',
          ],
        });
        break;
      }
      case "link-project":
      case "link": {
        const data = linkProject({
          repo: opts.repo,
          name: opts.name,
          force: opts.force,
          dryRun: opts.dryRun,
        });
        emit({
          data,
          json: opts.json,
          help: [
            "Prefer `ai-md init-project --repo <path>` to seed from template first",
          ],
        });
        break;
      }
      case "install": {
        // clone/pull via bash, then Node links (incl. agents)
        const bashArgs = ["install"];
        if (opts.force) bashArgs.push("--force");
        if (opts.dryRun) bashArgs.push("--dry-run");
        const result = spawnSync(
          "bash",
          [path.join(scriptsDir, "sync-config.sh"), ...bashArgs],
          { stdio: "inherit", env: process.env }
        );
        if (result.status !== 0) {
          process.exit(result.status === null ? 1 : result.status);
        }
        const links = [
          ...ensureCursorLinks(cfg, { force: opts.force, dryRun: opts.dryRun }),
          ...ensureAgentSkillLinks(cfg, opts.agents, {
            force: opts.force,
            dryRun: opts.dryRun,
          }),
        ];
        const data = collectStatus({ full: opts.full, agents: opts.agents });
        emit({
          data: { install: "ok", links, ...data },
          json: opts.json,
          help: [
            "Run `ai-md ensure-tools` to install grok + quota-axi",
            "Run `ai-md init-project --repo <path>` for a new app",
          ],
        });
        break;
      }
      case "pull":
        runBash("sync-config.sh", [
          "pull",
          ...(opts.dryRun ? ["--dry-run"] : []),
        ]);
        break;
      case "push": {
        const args = ["push"];
        if (opts.message) args.push("-m", opts.message);
        if (opts.dryRun) args.push("--dry-run");
        runBash("sync-config.sh", args);
        break;
      }
      case "ensure-tools":
      case "tools":
        runBash("ensure-agent-tools.sh", [
          ...(opts.dryRun ? ["--dry-run"] : []),
        ]);
        break;
      default:
        fail(`unknown command: ${opts.cmd}`, {
          exitCode: 2,
          json: opts.json,
          help: ["Run `ai-md --help`"],
        });
        process.exit(2);
    }
  } catch (err) {
    fail(err.message || String(err), {
      exitCode: err.code === "EINVAL" ? 2 : 1,
      json: opts.json,
      help: ["Run `ai-md --help`"],
    });
    process.exit(process.exitCode || 1);
  }
}

main();
