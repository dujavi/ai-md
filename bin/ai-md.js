#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const {
  resolveConfig,
  applyEnvFromConfig,
  writeMachineConfig,
  readMachineConfig,
  expandHome,
} = require("../lib/config");
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

function parseArgs(argv) {
  const out = {
    cmd: null,
    json: false,
    full: false,
    force: false,
    dryRun: false,
    fix: false,
    tools: false,
    message: null,
    repo: null,
    name: null,
    project: null,
    from: "base",
    remote: null,
    dir: null,
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
      case "--tools":
        out.tools = true;
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
      case "--remote":
        out.remote = args.shift();
        break;
      case "--dir":
        out.dir = expandHome(args.shift());
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
      case "set":
      case "show":
        // subcommand for `ai-md config set|show`
        out.rest.push(a);
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

Machine config (persisted):
  ~/.config/ai-md/config.json   dir + remote (override with AI_MD_CONFIG)
  Precedence: --flag > env > config file > defaults

Commands:
  setup              First-time machine setup: save config, install, optional --tools
  config             Show persisted config (or: config set --remote/--dir)
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
  --remote <url>     Private content git remote (persisted by setup/config set/install)
  --dir <path>       Local AI_MD_DIR (default ~/.ai-md; persisted same way)
  --json             JSON instead of TOON
  --full             Include paths and drift details
  --agents <list>    Skill link targets: cursor,claude,agents (default: cursor)
  --tools            With setup: also run ensure-tools
  --repo <path>      App repository root
  --name <id>        Project id under projects/
  --project <id>     Target project for apply-template
  --from <id>        Template under templates/ (default: base)
  --force            Replace non-symlink paths
  --dry-run          Preview without writing
  --fix             doctor: repair symlinks
  -m, --message      push commit message

Examples:
  ai-md setup --remote https://github.com/<you>/.ai-md.git --tools
  ai-md config set --remote https://github.com/<you>/.ai-md.git --dir ~/.ai-md
  ai-md config
  ai-md install --remote https://github.com/<you>/.ai-md.git
  ai-md init-project --repo ~/presenter --from base
`);
}

function runBash(script, args, env) {
  const result = spawnSync("bash", [path.join(scriptsDir, script), ...args], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    fail(result.error.message, { exitCode: 1 });
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

function persistIfRequested(opts) {
  if (opts.remote == null && opts.dir == null) return null;
  return writeMachineConfig(
    { dir: opts.dir, remote: opts.remote },
    process.env,
    { dryRun: opts.dryRun }
  );
}

function runInstall(cfg, opts) {
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
  return links;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.cmd === "help" || opts.cmdHelp) {
    printHelp();
    return;
  }

  // Resolve after flags so --dir/--remote apply
  let cfg = resolveConfig(process.env, {
    dir: opts.dir || undefined,
    remote: opts.remote || undefined,
  });
  applyEnvFromConfig(cfg);

  try {
    switch (opts.cmd) {
      case "config": {
        const sub = opts.rest[0] || "show";
        if (sub === "set") {
          if (opts.remote == null && opts.dir == null) {
            fail("config set requires --remote and/or --dir", {
              exitCode: 2,
              json: opts.json,
              help: [
                "ai-md config set --remote https://github.com/<you>/.ai-md.git --dir ~/.ai-md",
              ],
            });
            process.exit(2);
          }
          const saved = writeMachineConfig(
            { dir: opts.dir, remote: opts.remote },
            process.env,
            { dryRun: opts.dryRun }
          );
          cfg = resolveConfig(process.env);
          emit({
            data: { ...saved, resolved: { dir: cfg.dir, remote: cfg.remote, sources: cfg.sources } },
            json: opts.json,
            help: [
              "Run `ai-md install` if ~/.ai-md is not cloned yet",
              "Run `ai-md setup --remote <url> --tools` for first-time machine bootstrap",
            ],
          });
          break;
        }
        const stored = readMachineConfig();
        cfg = resolveConfig(process.env);
        emit({
          data: {
            path: stored.path,
            stored: stored.raw,
            resolved: {
              dir: cfg.dir,
              remote: cfg.remote,
              sources: cfg.sources,
            },
          },
          json: opts.json,
          help: [
            "ai-md config set --remote <url> --dir ~/.ai-md",
            "Flags and env override the config file",
          ],
        });
        break;
      }
      case "setup": {
        if (!opts.remote && !cfg.machineConfig?.remote && cfg.sources.remote === "default") {
          // Allow default for dujavi, but recommend explicit remote for others via help
        }
        const saved = writeMachineConfig(
          {
            dir: opts.dir || cfg.dir,
            remote: opts.remote || cfg.remote,
          },
          process.env,
          { dryRun: opts.dryRun }
        );
        cfg = resolveConfig(process.env, {
          dir: opts.dir || undefined,
          remote: opts.remote || undefined,
        });
        applyEnvFromConfig(cfg);
        const links = opts.dryRun
          ? []
          : runInstall(cfg, opts);
        let tools = null;
        if (opts.tools && !opts.dryRun) {
          const tr = spawnSync(
            "bash",
            [path.join(scriptsDir, "ensure-agent-tools.sh")],
            { stdio: "inherit", env: process.env }
          );
          tools = { exitCode: tr.status };
        }
        const data = collectStatus({
          full: opts.full,
          agents: opts.agents,
          from: opts.from,
        });
        emit({
          data: {
            setup: "ok",
            config: saved,
            links,
            tools,
            ...data,
          },
          json: opts.json,
          help: [
            opts.tools
              ? "Run `ai-md status` to verify"
              : "Run `ai-md ensure-tools` (or re-run setup with --tools)",
            "Run `ai-md init-project --repo <path> --from base` for a new app",
          ],
        });
        break;
      }
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
        const saved = persistIfRequested(opts);
        if (saved) {
          cfg = resolveConfig(process.env, {
            dir: opts.dir || undefined,
            remote: opts.remote || undefined,
          });
          applyEnvFromConfig(cfg);
        }
        const links = runInstall(cfg, opts);
        const data = collectStatus({ full: opts.full, agents: opts.agents });
        emit({
          data: { install: "ok", config: saved, links, ...data },
          json: opts.json,
          help: [
            "Run `ai-md ensure-tools` to install grok + quota-axi",
            "Run `ai-md init-project --repo <path>` for a new app",
          ],
        });
        break;
      }
      case "pull":
        runBash(
          "sync-config.sh",
          ["pull", ...(opts.dryRun ? ["--dry-run"] : [])],
          process.env
        );
        break;
      case "push": {
        const args = ["push"];
        if (opts.message) args.push("-m", opts.message);
        if (opts.dryRun) args.push("--dry-run");
        runBash("sync-config.sh", args, process.env);
        break;
      }
      case "ensure-tools":
      case "tools":
        runBash(
          "ensure-agent-tools.sh",
          [...(opts.dryRun ? ["--dry-run"] : [])],
          process.env
        );
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
