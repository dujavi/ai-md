"use strict";

const { execFileSync } = require("child_process");

function runCapture(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts.timeout || 20000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * GitHub login from authenticated `gh`, else git config github.user.
 */
function detectGithubUser() {
  const fromGh = runCapture("gh", ["api", "user", "-q", ".login"]);
  if (fromGh && !fromGh.includes(" ") && /^[A-Za-z0-9-]+$/.test(fromGh)) {
    return { user: fromGh, via: "gh" };
  }
  const fromGit = runCapture("git", ["config", "--global", "github.user"]);
  if (fromGit && /^[A-Za-z0-9-]+$/.test(fromGit)) {
    return { user: fromGit, via: "git" };
  }
  return { user: null, via: null };
}

function candidateRemotes(user) {
  return [
    `https://github.com/${user}/.ai-md.git`,
    `git@github.com:${user}/.ai-md.git`,
  ];
}

function remoteReachable(url) {
  const out = runCapture("git", ["ls-remote", "--exit-code", url, "HEAD"], {
    timeout: 25000,
  });
  // ls-remote --exit-code returns null from runCapture on failure
  // success returns stdout (may be empty-ish but non-null string with sha)
  return out != null;
}

function repoExistsViaGh(user) {
  const url = runCapture("gh", [
    "repo",
    "view",
    `${user}/.ai-md`,
    "--json",
    "url",
    "-q",
    ".url",
  ]);
  return Boolean(url);
}

/**
 * Only invent a default remote when gh/git identifies a user AND
 * github.com/{user}/.ai-md exists.
 */
function detectDefaultRemote() {
  const { user, via } = detectGithubUser();
  if (!user) {
    return {
      remote: null,
      source: "none",
      githubUser: null,
      githubVia: null,
      verified: false,
    };
  }

  if (repoExistsViaGh(user)) {
    return {
      remote: `https://github.com/${user}/.ai-md.git`,
      source: "detected",
      githubUser: user,
      githubVia: via,
      verified: true,
    };
  }

  for (const url of candidateRemotes(user)) {
    if (remoteReachable(url)) {
      return {
        remote: url.startsWith("git@")
          ? `https://github.com/${user}/.ai-md.git`
          : url,
        source: "detected",
        githubUser: user,
        githubVia: via,
        verified: true,
      };
    }
  }

  return {
    remote: null,
    source: "none",
    githubUser: user,
    githubVia: via,
    verified: false,
    hint: `No github.com/${user}/.ai-md repo found (create it or pass --remote)`,
  };
}

module.exports = {
  detectGithubUser,
  detectDefaultRemote,
  remoteReachable,
  candidateRemotes,
};
