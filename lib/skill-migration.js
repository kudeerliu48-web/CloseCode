"use strict";

const fs = require("fs"), path = require("path");
const store = require("../store");
const {userSkillName, withSkillName, declaredName, LEGACY_BUILTIN_ALIASES} = require("./skill-names");

function readMigrationState(dataDir) {
  const file = path.join(dataDir,"data","skill-name-migrations.json");
  const state = store.readJson(file, {aliases:{},moves:[]});
  if (!state || typeof state !== "object" || Array.isArray(state) || (state.moves && !Array.isArray(state.moves))) throw Error("技能迁移记录格式不正确");
  state.aliases = Object.assign(Object.create(null),state.aliases || {});
  state.moves ||= [];
  return state;
}

function readAliases(dataDir) {
  return readMigrationState(dataDir).aliases;
}

// Persist intent before renaming directories. A restart can finish a move or a
// reference update without losing the original names or overwriting a collision.
function migrateSkills({dataDir, appDir, catalog}) {
  const root = path.join(dataDir,"skills"), file = path.join(dataDir,"data","skill-name-migrations.json");
  const state = readMigrationState(dataDir);
  const save = () => store.writeJsonAtomic(file,state,{pretty:true});
  const child = name => {
    if (!name || path.basename(name) !== name || name === "." || name === "..") throw Error("技能迁移目录不合法");
    return path.join(root,name);
  };
  const finish = move => {
    const from = child(move.from), to = child(move.to);
    if (from !== to && fs.existsSync(from)) {
      if (fs.existsSync(to)) throw Error("技能迁移目标已存在：" + move.to);
      fs.renameSync(from,to);
    }
    if (!fs.existsSync(to)) throw Error("技能迁移目录不存在：" + move.to);
    const main = path.join(to,move.main), raw = fs.readFileSync(main,"utf8");
    if (!fs.existsSync(main + ".before-name-migration")) fs.writeFileSync(main + ".before-name-migration",raw,{flag:"wx"});
    fs.writeFileSync(main,withSkillName(raw,move.name),"utf8");
    move.done = true; save();
  };
  for (const move of state.moves.filter(m=>!m.done)) finish(move);
  if (!fs.existsSync(root)) return state.aliases;
  const entries = fs.readdirSync(root,{withFileTypes:true});
  const used = new Set(entries.map(e=>e.name.toLowerCase()));
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || /\.(?:bak|backup)$/i.test(entry.name)) continue;
    const dir = child(entry.name), main = fs.readdirSync(dir).find(f=>/^skill\.md$/i.test(f));
    if (!main) continue;
    const raw = fs.readFileSync(path.join(dir,main),"utf8"), oldName = declaredName(raw) || entry.name;
    const builtin = catalog.skills.find(s => [s.directory,s.name].includes(entry.name) && [s.directory,s.name,...(s.legacyNames||[])].includes(oldName));
    // Source checkouts are also the release source; built-in directory names there
    // stay fixed. Installed copies use the public canonical name as their directory.
    if (builtin && dataDir === appDir) continue;
    let name = builtin ? builtin.name : userSkillName(oldName);
    if (entry.name === name && oldName === name) continue;
    if (name !== entry.name && used.has(name.toLowerCase())) {
      const base = userSkillName(oldName); name = base;
      for (let i=2;used.has(name.toLowerCase());i++) name = base.slice(0,54) + "_" + i;
    }
    used.add(name.toLowerCase());
    if (!builtin) for (const alias of [oldName,entry.name]) if (alias !== name) state.aliases[alias] = name;
    const move = {from:entry.name,to:name,main,name,done:false};
    state.moves.push(move); save(); finish(move);
  }
  const canonical = value => {
    // A canonical built-in binding always retains its explicit identity, even
    // when a legacy user skill declared the same name in another directory.
    if (catalog.skills.some(s=>s.name===value)) return value;
    if (state.aliases[value]) return state.aliases[value];
    const old = Object.hasOwn(LEGACY_BUILTIN_ALIASES,value) ? LEGACY_BUILTIN_ALIASES[value] : value;
    return catalog.skills.find(s=>s.name===old || s.directory===old || s.legacyNames?.includes(old))?.name || value;
  };
  // Only structured references change; prompt text and skill instructions retain
  // their original wording. Legacy calls resolve through the saved aliases.
  for (const [name,key] of [["experts.json","experts"],["config.json","projects"]]) {
    const target = path.join(dataDir,name);
    if (!fs.existsSync(target)) continue;
    let value;
    try { value = JSON.parse(fs.readFileSync(target,"utf8")); }
    catch { console.warn(`[技能] ${name} 无法解析，绑定暂通过旧名称兼容`); continue; }
    let changed = false;
    for (const entry of Array.isArray(value[key]) ? value[key] : []) {
      if (!Array.isArray(entry.skills)) continue;
      const skills = [...new Set(entry.skills.map(canonical))];
      if (JSON.stringify(skills) !== JSON.stringify(entry.skills)) { entry.skills = skills; changed = true; }
    }
    if (changed) store.writeJsonAtomic(target,value,{pretty:true});
  }
  return state.aliases;
}

module.exports = {migrateSkills,readAliases,readMigrationState};
