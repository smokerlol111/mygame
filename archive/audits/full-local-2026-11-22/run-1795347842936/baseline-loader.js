const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "../../../..");
const filename = path.join(root, "server.js");
const baseline = new Module(filename, module);
baseline.filename = filename;
baseline.paths = Module._nodeModulePaths(root);
const nativeRequire = baseline.require.bind(baseline);
baseline.require = name => name !== "fs" || !process.env.GAMES_INDEX_FILE ? nativeRequire(name) : new Proxy(fs, { get(target, field) {
  if (field !== "readFileSync") return target[field];
  return (file, ...args) => { const base = path.join(root, "games"); const full = typeof file === "string" ? path.resolve(file) : "";
    const input = full.startsWith(base + path.sep) ? path.join(path.dirname(process.env.GAMES_INDEX_FILE), path.relative(base, full)) : file;
    return target.readFileSync(input, ...args); };
} });
baseline._compile(fs.readFileSync(path.join(__dirname, "server-before-refactor.js"), "utf8"), filename);
