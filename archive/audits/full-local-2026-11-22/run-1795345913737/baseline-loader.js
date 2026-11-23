const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "../../../..");
const filename = path.join(root, "server.js");
const baseline = new Module(filename, module);
baseline.filename = filename;
baseline.paths = Module._nodeModulePaths(root);
baseline._compile(fs.readFileSync(path.join(__dirname, "server-before-refactor.js"), "utf8"), filename);
