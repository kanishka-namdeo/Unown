/** Shared path wiring for scenario specs (env-overridable). */
const path = require("node:path");
const REPO_ROOT = process.env.UNOWN_ROOT || path.resolve(__dirname, "..", "..", "..");
const DEMO_DIR = process.env.UNOWN_DEMO_DIR || "/home/z/my-project/demo-projects/api-server";
module.exports = { REPO_ROOT, DEMO_DIR, unownBin: path.join(REPO_ROOT, "bin", "unown") };
