"use strict";

// The 2.0.0 loader asks Node to resolve against the base package before checking
// the signed patch. New modules have no base file. Install this compatibility
// hook from an existing entry point; the protected loader itself stays intact.
function install(loader) {
  if (!loader.activePatch) return;
  const Module = require("module"), path = require("path"), fs = require("fs");
  const marker = Symbol.for("closecode.patch-new-modules");
  if (Module[marker]) return;
  Module[marker] = true;
  const original = Module._resolveFilename;
  Module._resolveFilename = function(request, parent, ...rest) {
    try { return original.call(this, request, parent, ...rest); }
    catch (error) {
      if (error.code !== "MODULE_NOT_FOUND" || !parent?.filename || (!request.startsWith(".") && !path.isAbsolute(request))) throw error;
      const patch = loader.activePatch;
      if (!patch) throw error;
      let filename = parent.filename;
      if (filename.startsWith(patch.patchDir + path.sep)) filename = path.join(loader.APP_DIR, path.relative(patch.patchDir, filename));
      if (!filename.startsWith(loader.APP_DIR + path.sep)) throw error;
      const candidate = path.resolve(path.dirname(filename), request);
      const rel = path.relative(loader.APP_DIR, candidate).split(path.sep).join("/");
      if (rel.startsWith("../") || path.isAbsolute(rel)) throw error;
      for (const name of [rel, rel + ".js", rel + ".json", rel + "/index.js", rel + "/index.json"]) {
        if (!patch.files.has(name) || patch.deleted.has(name)) continue;
        const file = loader.resolveAppFile(...name.split("/"));
        if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
      }
      throw error;
    }
  };
}

module.exports = {install};
