// Writes a small buildinfo.json next to the UI files. Runs before npm start,
// pack, and dist so the in-app version badge always shows the current version
// + the exact git commit it was built from. Gitignored - regenerated locally;
// stamped fresh at every release.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
let sha = "dev";
let dirty = false;
try {
  sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  const status = execSync("git status --porcelain", { encoding: "utf8" }).trim();
  dirty = status.length > 0;
} catch {}
const info = {
  version: pkg.version,
  sha,
  dirty,
  buildDate: new Date().toISOString().slice(0, 10),
  product: pkg.build?.productName || pkg.name,
};
writeFileSync(join(process.cwd(), "src", "ui", "buildinfo.json"), JSON.stringify(info, null, 2) + "\n");
console.log("stamped:", info);
