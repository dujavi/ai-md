"use strict";

const { encode } = require("@toon-format/toon");

function emit({ data, json = false, help = [] }) {
  if (json) {
    const payload = help.length ? { ...data, help } : data;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${encode(data)}\n`);
  if (help.length) {
    process.stdout.write(`help[${help.length}]:\n`);
    for (const line of help) {
      process.stdout.write(`  ${JSON.stringify(line)}\n`);
    }
  }
}

function fail(message, { exitCode = 1, help = [], json = false } = {}) {
  const data = {
    error: message,
    ...(help.length ? { help } : {}),
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    process.stdout.write(`${encode(data)}\n`);
    if (help.length) {
      process.stdout.write(`help[${help.length}]:\n`);
      for (const line of help) {
        process.stdout.write(`  ${JSON.stringify(line)}\n`);
      }
    }
  }
  process.exitCode = exitCode;
}

module.exports = { emit, fail, encode };
