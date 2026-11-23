const fs = require("fs");
const path = require("path");

function createPublicBaseUrl(rootDir) {
  function publicBaseUrl(req) {
    // The launcher updates this file even when it reuses an already running server.
    let configured = process.env.PUBLIC_URL;
    if (!configured) {
      try {
        configured = fs.readFileSync(process.env.FUNNEL_URL_FILE || path.join(rootDir, ".funnel-url"), "utf8").trim();
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (configured) {
      const url = new URL(configured);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error("PUBLIC_URL must be an HTTP(S) address without credentials.");
      return url.origin;
    }
    const forwardProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
    return `${forwardProto === "https" ? "https" : req.protocol}://${req.get("host")}`;
  }
  return publicBaseUrl;
}

module.exports = { createPublicBaseUrl };
