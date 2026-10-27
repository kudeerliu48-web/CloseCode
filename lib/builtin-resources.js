"use strict";

const fs = require("fs");
const path = require("path");
const store = require("../store");

function readCatalog(file) {
  const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(catalog.skills) || !Array.isArray(catalog.experts) || !Array.isArray(catalog.teams)) throw Error("内置资源清单格式不正确");
  const names = new Set(), directories = new Set();
  for (const skill of catalog.skills) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(skill.directory) || names.has(skill.name) || directories.has(skill.directory)) throw Error("内置技能名称或目录重复、不合法");
    names.add(skill.name); directories.add(skill.directory);
    if (!Array.isArray(skill.files) || !skill.files.some(f => /^skill\.md$/i.test(f))) throw Error("内置技能缺少入口：" + skill.name);
    for (const rel of skill.files) {
      if (rel.includes("\\") || rel.split("/").some(p => !p || p === "." || p === ".." || p.includes(":"))) throw Error("内置技能资源路径不合法");
    }
  }
  return catalog;
}

function skillFiles(catalog) {
  return catalog.skills.flatMap(s => s.files.map(file => "skills/" + s.directory + "/" + file));
}

function isExpertData(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && (value.experts === undefined || Array.isArray(value.experts))
    && (value.teams === undefined || Array.isArray(value.teams));
}

// A present file can still contain old or empty presets. Merge records, keeping
// user prompts, members and other metadata exactly as saved.
function seedExperts(file, catalog) {
  let previous = "", current = {}, invalid = false;
  if (fs.existsSync(file)) {
    previous = fs.readFileSync(file, "utf8");
    try { current = JSON.parse(previous); invalid = !isExpertData(current); }
    catch { invalid = true; }
    if (invalid) {
      // Preserve the original before consulting the previous valid version.
      const backup = file + ".before-builtin-repair-" + Date.now();
      fs.writeFileSync(backup, previous, {flag:"wx"});
      try { current = JSON.parse(fs.readFileSync(file + ".bak", "utf8")); }
      catch { current = {}; }
      if (!isExpertData(current)) current = {};
    }
  }
  const merged = {...current};
  for (const key of ["experts", "teams"]) {
    const saved = current[key] || [];
    const names = new Set(saved.map(item => item?.name));
    merged[key] = [...saved, ...catalog[key].filter(item => !names.has(item.name))];
  }
  if (invalid || !fs.existsSync(file) || JSON.stringify(merged) !== JSON.stringify(current)) {
    store.writeJsonAtomic(file, merged, {pretty:true});
  }
  return merged;
}

module.exports = {readCatalog, skillFiles, seedExperts};
