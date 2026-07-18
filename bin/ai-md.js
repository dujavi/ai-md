#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const os = require("os");
const path = require("path");

const scriptsDir = path.join(__dirname, "..", "scripts");
const home = os.homedir();

const env = {
  ...process.env,
  AI_MD_DIR:
    process.env.AI_MD_DIR ||
    process.env.CURSOR_MD_DIR ||
    path.join(home, ".ai-md"),
  AI_MD_REMOTE:
    process.env.AI_MD_REMOTE ||
    process.env.CURSOR_MD_REMOTE ||
    "https://github.com/dujavi/.ai-md.git",
};

// Keep legacy env names in sync for older wrappers.
env.CURSOR_MD_DIR = env.AI_MD_DIR;
env.CURSOR_MD_REMOTE = env.AI_MD_REMOTE;

const COMMANDS = {
  install: { script: "sync-config.sh", prefix: ["install"] },
  pull: { script: "sync-config.sh", prefix: ["pull"] },
  push: { script: "sync-config.sh", prefix: ["push"] },
  status: { script: "sync-config.sh", prefix: ["status"] },
  doctor: { script: "sync-config.sh", prefix: ["doctor"] },
  "ensure-tools": { script: "ensure-agent-tools.sh", prefix: [] },
  tools: { script: "ensure-agent-tools.sh", prefix: [] },
  "link-project": { script: "link-project.sh", prefix: [] },
  link: { script: "link-project.sh", prefix: [] },
};

function printHelp() {
  console.log(`ai-md — sync private ~/.ai-md skills/rules; install agent CLIs

Usage:
  ai-md <command> [options]
  npx ai-md <command> [options]

Commands:
  install          Clone AI_MD_REMOTE → ~/.ai-md (if needed); link ~/.cursor/{skills,rules}
  pull             git pull private config; refresh symlinks
  push             commit + push private config (-m/--message)
  status           repo + symlink health
  doctor           diagnose; --fix repairs symlinks
  ensure-tools     install/update grok + quota-axi (alias: tools)
  link-project     link a repo .cursor/ → ~/.ai-md/projects/<name>/
  help             show this help

Environment:
  AI_MD_DIR        Private config dir (default: ~/.ai-md)
  AI_MD_REMOTE     Git remote if clone needed (default: https://github.com/dujavi/.ai-md.git)

Examples:
  npm i -g ai-md
  ai-md install
  ai-md ensure-tools
  ai-md pull
  ai-md push -m "Add routing rule"
  ai-md link-project --repo ~/presenter
  ai-md doctor --fix

Private skills/rules live in each person's AI_MD_DIR repo.
This package ships tooling only — no personal content.
`);
}

const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
  printHelp();
  process.exit(0);
}

const mapped = COMMANDS[cmd];
if (!mapped) {
  console.error(`error: unknown command: ${cmd}`);
  console.error(`  ai-md --help`);
  process.exit(2);
}

const scriptPath = path.join(scriptsDir, mapped.script);
const result = spawnSync("bash", [scriptPath, ...mapped.prefix, ...args], {
  stdio: "inherit",
  env,
});

if (result.error) {
  console.error(`error: failed to run ${mapped.script}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
