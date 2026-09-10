import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";

execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.adapter.json"], { stdio: "inherit" });
const root = ".release/adapter";
async function fixImports(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await fixImports(file);
    else if (file.endsWith(".js") || file.endsWith(".d.ts")) {
      const source = await readFile(file, "utf8");
      await writeFile(file, source.replace(/((?:from|import)\s*["'])(\.\.?\/[^"']+)(["'])/g,
        (_, prefix, specifier, quote) => `${prefix}${specifier.endsWith(".js") ? specifier : `${specifier}.js`}${quote}`));
    }
  }
}
await fixImports(`${root}/dist`);
const project = JSON.parse(await readFile("package.json", "utf8"));
await mkdir(root, { recursive: true });
await writeFile(`${root}/package.json`, JSON.stringify({
  name: "@ahmardchain/lucid-keeperhub-settlement", version: "0.1.0",
  description: "Post-fulfillment Base Sepolia settlement for Lucid paid tasks",
  type: "module", engines: { node: ">=22.13.0" },
  exports: { ".": { types: "./dist/adapter.d.ts", import: "./dist/adapter.js" } },
  files: ["dist", "README.md", "LICENSE"],
  dependencies: Object.fromEntries(Object.entries(project.dependencies).filter(([name]) =>
    name.startsWith("@lucid-agents/") || ["hono", "zod"].includes(name))),
}, null, 2));
await copyFile("docs/adapter.md", `${root}/README.md`);
await copyFile("LICENSE", `${root}/LICENSE`);
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--offline", "--ignore-scripts", "--pack-destination", ".."], { cwd: root, stdio: "inherit" });
