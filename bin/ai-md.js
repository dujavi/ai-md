#!/usr/bin/env node
"use strict";

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
  runInstall,
  runPull,
  runPush,
  buildAndLink,
  runBuild,
  runRescue,
  seedSkeleton,
  initRepo,
  harnessList,
  harnessShow,
  harnessSet,
  harnessUnset,
  harnessEnable,
} = require("../lib/commands");
const { runScript, runScripts } = require("../lib/scripts");
const { defaultLinkMode } = require("../lib/config-paths");

function applyFlag(out, flag, args) {
  switch (flag) {
    case "--json":
      out.json = true;
      return true;
    case "--full":
      out.full = true;
      return true;
    case "--force":
      out.force = true;
      return true;
    case "--dry-run":
      out.dryRun = true;
      return true;
    case "--fix":
      out.fix = true;
      out.force = true;
      return true;
    case "--force-link":
      out.forceLink = true;
      return true;
    case "--init":
      out.init = true;
      return true;
    case "--no-git":
      out.noGit = true;
      return true;
    case "--verbose":
      out.verbose = true;
      return true;
    case "--paths-only":
      out.pathsOnly = true;
      return true;
    case "-m":
    case "--message":
      out.message = args.shift();
      return true;
    case "--repo":
      out.repo = args.shift();
      return true;
    case "--name":
      out.name = args.shift();
      return true;
    case "--project":
      out.project = args.shift();
      return true;
    case "--from":
      out.from = args.shift();
      return true;
    case "--remote":
      out.remote = args.shift();
      return true;
    case "--dir":
      out.dir = expandHome(args.shift());
      return true;
    case "--skills":
      out.skills = args.shift();
      return true;
    case "--rules":
      out.rules = args.shift();
      return true;
    case "--format":
      out.format = args.shift();
      return true;
    case "--link-mode":
      out.linkMode = args.shift();
      return true;
    case "--agents":
      out.agents = String(args.shift() || "cursor")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return true;
    case "--script": {
      const name = args.shift();
      if (!name) {
        fail("--script requires a name", {
          exitCode: 2,
          json: out.json,
          help: ["ai-md setup --script ensure-tools"],
        });
        process.exit(2);
      }
      out.scripts.push(name);
      return true;
    }
    case "-h":
    case "--help":
      out.cmdHelp = true;
      return true;
    default:
      return false;
  }
}

function parseArgs(argv) {
  const out = {
    cmd: null,
    json: false,
    full: false,
    force: false,
    dryRun: false,
    fix: false,
    forceLink: false,
    init: false,
    noGit: false,
    verbose: false,
    pathsOnly: false,
    message: null,
    repo: null,
    name: null,
    project: null,
    from: "base",
    remote: null,
    dir: null,
    skills: null,
    rules: null,
    format: null,
    linkMode: null,
    agents: null,
    scripts: [],
    scriptName: null,
    scriptArgs: [],
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

  if (out.cmd === "script" || out.cmd === "run-script") {
    while (args.length) {
      const a = args[0];
      if (a === "--") {
        fail("script name required before `--`", {
          exitCode: 2,
          json: out.json,
          help: ["ai-md script ensure-tools -- --dry-run"],
        });
        process.exit(2);
      }
      if (a.startsWith("-")) {
        args.shift();
        if (!applyFlag(out, a, args)) {
          fail(`unknown flag: ${a}`, { exitCode: 2, json: out.json });
          process.exit(2);
        }
        continue;
      }
      out.scriptName = args.shift();
      break;
    }
    if (!out.scriptName) {
      fail("script requires a name", { exitCode: 2, json: out.json });
      process.exit(2);
    }
    if (args[0] === "--") args.shift();
    out.scriptArgs = args;
    return out;
  }

  while (args.length) {
    const a = args.shift();
    if (a === "--") {
      out.scriptArgs = args;
      break;
    }
    if (
      a === "set" ||
      a === "show" ||
      a === "list" ||
      a === "unset" ||
      a === "enable" ||
      a === "disable"
    ) {
      out.rest.push(a);
      continue;
    }
    if (a.startsWith("-")) {
      if (!applyFlag(out, a, args)) {
        fail(`unknown flag: ${a}`, {
          exitCode: 2,
          json: out.json,
          help: ["Run `ai-md --help`"],
        });
        process.exit(2);
      }
      continue;
    }
    out.rest.push(a);
  }
  return out;
}

function printHelp() {
  process.stdout.write(`ai-md — private ~/.ai-md: shared + agents → dist → live harnesses

Usage:
  ai-md [command] [options]

Layout (source):
  ~/.ai-md/shared/{rules,skills}   Cross-harness
  ~/.ai-md/agents/<id>/            Harness overlays
  ~/.ai-md/dist/<id>/              Build output (gitignored)
  ~/.ai-md/templates, projects, scripts

Unique sync targets: cursor, claude, gemini, opencode, copilot
Shared ~/.agents/skills: agents (canonical); codex is an alias

Commands:
  init               Scaffold skeleton into ~/.ai-md (no remote required)
  seed-skeleton      Add missing recommended files only
  setup              Persist config + install (+ optional --init / --script)
  config             Show config; config set --remote/--dir/--link-mode
  status             Snapshot (default)
  doctor             Diagnose; --fix rebuilds + relinks (installed AIs only)
  build              Merge shared+agents → dist/
  rescue             Promote dirty dist → agents/<id>/
  install | pull     Git sync + build + link (skip harnesses not installed)
  push               Commit + push private repo
  harness            list | show | set | unset | enable | disable
  script             Run ~/.ai-md/scripts/<name>
  init-project       Seed projects/<name> + link .cursor/
  apply-template | link-project | link
  help

Options:
  --agents <list>    Harnesses (default: config agents or cursor)
  --force-link       Link even if AI does not look installed
  --force            Replace real dirs / discard dirty dist on build
  --link-mode <m>    symlink | junction | copy
  --dry-run --json --full --verbose
  --remote --dir --skills --rules --format
  --script <name>    (repeatable on setup/install)

Examples:
  ai-md init
  ai-md setup --remote https://github.com/<you>/.ai-md.git
  ai-md build && ai-md doctor --fix
  ai-md harness set my-tool --skills ~/.my-tool/skills --format md
  ai-md rescue --agents cursor
`);
}

function agentsOrDefault(opts, cfg) {
  return opts.agents || cfg.agents || ["cursor"];
}

function persistIfRequested(opts) {
  if (
    opts.remote == null &&
    opts.dir == null &&
    opts.linkMode == null &&
    opts.agents == null
  ) {
    return null;
  }
  const patch = {};
  if (opts.dir != null) patch.dir = opts.dir;
  if (opts.remote != null) patch.remote = opts.remote;
  if (opts.linkMode != null) patch.linkMode = opts.linkMode;
  if (opts.agents != null) patch.agents = opts.agents;
  return writeMachineConfig(patch, process.env, { dryRun: opts.dryRun });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.cmd === "help" || opts.cmdHelp) {
    printHelp();
    return;
  }

  let cfg = resolveConfig(process.env, {
    dir: opts.dir || undefined,
    remote: opts.remote || undefined,
    linkMode: opts.linkMode || undefined,
  });
  applyEnvFromConfig(cfg);

  try {
    switch (opts.cmd) {
      case "config": {
        const sub = opts.rest[0] || "show";
        if (sub === "set") {
          if (
            opts.remote == null &&
            opts.dir == null &&
            opts.linkMode == null &&
            opts.agents == null
          ) {
            fail("config set requires --remote/--dir/--link-mode/--agents", {
              exitCode: 2,
              json: opts.json,
            });
            process.exit(2);
          }
          const saved = persistIfRequested(opts);
          cfg = resolveConfig(process.env);
          emit({
            data: {
              ...saved,
              resolved: {
                dir: cfg.dir,
                remote: cfg.remote,
                linkMode: cfg.linkMode,
                agents: cfg.agents,
                sources: cfg.sources,
              },
            },
            json: opts.json,
            help: ["Run `ai-md install` or `ai-md init`"],
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
              linkMode: cfg.linkMode,
              agents: cfg.agents,
              defaultLinkMode: defaultLinkMode(),
              sources: cfg.sources,
            },
          },
          json: opts.json,
          help: ["ai-md config set --remote <url> --dir ~/.ai-md"],
        });
        break;
      }
      case "init": {
        const data = initRepo(cfg, {
          noGit: opts.noGit,
          force: opts.force,
          dryRun: opts.dryRun,
        });
        writeMachineConfig(
          { dir: cfg.dir, agents: ["cursor"], linkMode: cfg.linkMode },
          process.env,
          { dryRun: opts.dryRun }
        );
        cfg = resolveConfig(process.env);
        let bl = null;
        if (!opts.dryRun) {
          bl = buildAndLink(cfg, {
            agents: ["cursor"],
            force: true,
            forceLink: opts.forceLink,
          });
        }
        emit({
          data: { init: data, buildLink: bl },
          json: opts.json,
          help: [
            "Edit shared/ or agents/<id>/",
            "Later: ai-md config set --remote <url> && git -C ~/.ai-md push -u origin main",
          ],
        });
        break;
      }
      case "seed-skeleton": {
        const data = seedSkeleton(cfg, {
          force: opts.force,
          dryRun: opts.dryRun,
        });
        emit({
          data,
          json: opts.json,
          help: ["Run `ai-md build` after seeding"],
        });
        break;
      }
      case "build": {
        const data = runBuild(cfg, {
          agents: agentsOrDefault(opts, cfg),
          force: opts.force,
          dryRun: opts.dryRun,
          verbose: opts.verbose,
          forceLink: true,
          includeUninstalled: true,
        });
        emit({
          data,
          json: opts.json,
          help: ["Run `ai-md doctor --fix` to link installed harnesses"],
        });
        break;
      }
      case "rescue": {
        const data = runRescue(cfg, {
          agents: agentsOrDefault(opts, cfg),
          dryRun: opts.dryRun,
        });
        emit({
          data,
          json: opts.json,
          help: ["Review agents/<id>/ then `ai-md build`"],
        });
        break;
      }
      case "harness": {
        const sub = opts.rest[0] || "list";
        const id = opts.rest[1];
        if (sub === "list") {
          emit({
            data: { harnesses: harnessList(cfg) },
            json: opts.json,
            help: ["ai-md harness show cursor"],
          });
          break;
        }
        if (sub === "show") {
          if (!id) {
            fail("harness show requires <id>", { exitCode: 2, json: opts.json });
            process.exit(2);
          }
          emit({
            data: harnessShow(cfg, id),
            json: opts.json,
            help: [],
          });
          break;
        }
        if (sub === "set") {
          if (!id) {
            fail("harness set requires <id>", { exitCode: 2, json: opts.json });
            process.exit(2);
          }
          const data = harnessSet(cfg, id, {
            skills: opts.skills,
            rules: opts.rules,
            format: opts.format,
          });
          emit({
            data,
            json: opts.json,
            help: [`Put overlays in agents/${id}/`, "ai-md build"],
          });
          break;
        }
        if (sub === "unset") {
          if (!id) {
            fail("harness unset requires <id>", { exitCode: 2, json: opts.json });
            process.exit(2);
          }
          emit({
            data: harnessUnset(cfg, id, { pathsOnly: opts.pathsOnly }),
            json: opts.json,
            help: [],
          });
          break;
        }
        if (sub === "enable" || sub === "disable") {
          if (!id) {
            fail(`harness ${sub} requires <id>`, { exitCode: 2, json: opts.json });
            process.exit(2);
          }
          emit({
            data: harnessEnable(cfg, id, sub === "enable"),
            json: opts.json,
            help: ["ai-md build && ai-md doctor --fix"],
          });
          break;
        }
        fail(`unknown harness subcommand: ${sub}`, { exitCode: 2, json: opts.json });
        process.exit(2);
        break;
      }
      case "setup": {
        if (opts.init && !opts.remote) {
          const data = initRepo(cfg, {
            noGit: opts.noGit,
            force: opts.force,
            dryRun: opts.dryRun,
          });
          writeMachineConfig(
            { dir: cfg.dir, agents: ["cursor"], linkMode: cfg.linkMode },
            process.env,
            { dryRun: opts.dryRun }
          );
          cfg = resolveConfig(process.env);
          const bl = opts.dryRun
            ? null
            : buildAndLink(cfg, {
                agents: agentsOrDefault(opts, cfg),
                force: true,
                forceLink: opts.forceLink,
              });
          emit({
            data: { setup: "init", init: data, buildLink: bl },
            json: opts.json,
            help: [],
          });
          break;
        }
        const saved = writeMachineConfig(
          {
            dir: opts.dir || cfg.dir,
            remote: opts.remote || cfg.remote,
            agents: opts.agents || cfg.agents,
            linkMode: opts.linkMode || cfg.linkMode,
          },
          process.env,
          { dryRun: opts.dryRun }
        );
        cfg = resolveConfig(process.env, {
          dir: opts.dir || undefined,
          remote: opts.remote || undefined,
        });
        applyEnvFromConfig(cfg);
        const result = opts.dryRun
          ? { build: null, link: null }
          : runInstall(cfg, {
              agents: agentsOrDefault(opts, cfg),
              force: opts.force,
              forceLink: opts.forceLink,
            });
        const scripts =
          opts.scripts.length === 0
            ? []
            : runScripts(cfg, opts.scripts, opts.scriptArgs, {
                dryRun: opts.dryRun,
              });
        const failed = scripts.find((s) => s.exitCode !== 0);
        const data = collectStatus({
          full: opts.full,
          agents: agentsOrDefault(opts, cfg),
          from: opts.from,
        });
        emit({
          data: { setup: "ok", config: saved, ...result, scripts, ...data },
          json: opts.json,
          help: statusHelp(data),
        });
        if (failed) process.exit(failed.exitCode);
        break;
      }
      case "status": {
        const data = collectStatus({
          full: opts.full,
          agents: agentsOrDefault(opts, cfg),
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
          agents: agentsOrDefault(opts, cfg),
          dryRun: opts.dryRun,
          forceLink: opts.forceLink,
        });
        emit({ data, json: opts.json, help: data.help });
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
          help: ['Run `ai-md push -m "Init <project>"` after review'],
        });
        break;
      }
      case "apply-template": {
        const data = applyTemplate({
          project: opts.project || opts.name,
          from: opts.from,
          dryRun: opts.dryRun,
        });
        emit({ data, json: opts.json, help: [] });
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
        emit({ data, json: opts.json, help: [] });
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
        const result = runInstall(cfg, {
          agents: agentsOrDefault(opts, cfg),
          force: opts.force,
          dryRun: opts.dryRun,
          forceLink: opts.forceLink,
        });
        const scripts =
          opts.scripts.length === 0
            ? []
            : runScripts(cfg, opts.scripts, opts.scriptArgs, {
                dryRun: opts.dryRun,
              });
        const failed = scripts.find((s) => s.exitCode !== 0);
        const data = collectStatus({
          full: opts.full,
          agents: agentsOrDefault(opts, cfg),
        });
        emit({
          data: { install: "ok", config: saved, ...result, scripts, ...data },
          json: opts.json,
          help: statusHelp(data),
        });
        if (failed) process.exit(failed.exitCode);
        break;
      }
      case "pull": {
        const result = runPull(cfg, {
          agents: agentsOrDefault(opts, cfg),
          force: opts.force,
          dryRun: opts.dryRun,
          forceLink: opts.forceLink,
        });
        emit({
          data: { pull: "ok", ...result },
          json: opts.json,
          help: ["Edit shared/ or agents/<id>/; ai-md push -m \"…\""],
        });
        break;
      }
      case "push": {
        const data = runPush(cfg, {
          message: opts.message,
          dryRun: opts.dryRun,
        });
        emit({ data, json: opts.json, help: [] });
        break;
      }
      case "script":
      case "run-script": {
        const result = runScript(cfg, opts.scriptName, opts.scriptArgs, {
          dryRun: opts.dryRun,
        });
        emit({
          data: { scripts: [result] },
          json: opts.json,
          help: ["Scripts live in ~/.ai-md/scripts/"],
        });
        process.exit(result.exitCode);
        break;
      }
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
      exitCode: err.code === "EINVAL" || err.code === "ENOENT" || err.code === "EEXIST" || err.code === "EDIRTY" ? 2 : 1,
      json: opts.json,
      help:
        err.code === "EDIRTY"
          ? ["ai-md rescue --agents <id>", "ai-md build --force"]
          : ["Run `ai-md --help`"],
    });
    process.exit(process.exitCode || 1);
  }
}

main();
