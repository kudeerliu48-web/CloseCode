"use strict";

// Built-ins and user-created/imported skills have separate, stable namespaces.
const BUILTIN_PREFIX = "user-";
const USER_PREFIX = "user_";
const LEGACY_BUILTIN_ALIASES = {"excel-report":"excel-processing", docx:"word-processing"};

function userSkillName(value) {
  const bare = String(value || "").trim().replace(/^(?:user[-_])+/i, "")
    .replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/[. ]+$/, "");
  if (!bare || bare === "." || bare === "..") throw Error("技能名不合法");
  return USER_PREFIX + bare.slice(0, 60 - USER_PREFIX.length);
}

function withSkillName(raw, name) {
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return "---" + newline + "name: " + name + newline + "description: " + newline + "---" + newline + raw;
  const header = /^name:.*$/m.test(match[1]) ? match[1].replace(/^name:.*$/m, "name: " + name) : "name: " + name + newline + match[1];
  return "---" + newline + header + newline + "---" + newline + raw.slice(match[0].length);
}

function declaredName(raw) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] || "";
  return /^name:\s*(.+)$/m.exec(header)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
}

module.exports = {BUILTIN_PREFIX, USER_PREFIX, LEGACY_BUILTIN_ALIASES, userSkillName, withSkillName, declaredName};
