import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return readCssTree(entryPath);
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("renders the custody and post-fulfillment invariant", async () => {
  const { default: Home } = await vite.ssrLoadModule("/app/page.tsx");
  const html = renderToStaticMarkup(React.createElement(Home));

  assert.match(html, /Pay after proof/);
  assert.match(html, /x402 sends USDC into a KeeperHub-controlled wallet/);
  assert.match(html, /The wallet is not called escrow/);
  assert.match(html, /KeeperHub is the sole post-task spender/);
  assert.match(html, /The failure demo is the product demo/);
});

test("renders an accessible, explicit payout/refund trace", async () => {
  const { SettlementFlow } = await vite.ssrLoadModule(
    "/components/settlement-flow.tsx",
  );
  const html = renderToStaticMarkup(React.createElement(SettlementFlow));

  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /DETERMINISTIC GATE \/ NO LLM/);
  assert.match(html, /simulate → execute once → verify receipt/);
  assert.match(html, /Never a caller-supplied refund address/);
});

test("ships restrained motion, visible focus, and mobile layouts", async () => {
  const css = await readCssTree(path.join(root, "dist"));

  assert.match(css, /--aqua:/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\((?:max-width:\s*620px|width<=620px)\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation-iteration-count:\s*1\s*!important/);
});

test("does not present placeholder hashes as live evidence", async () => {
  const raw = await readFile(
    path.join(root, "public/evidence/receipts.json"),
    "utf8",
  );
  const bundle = JSON.parse(raw);

  assert.equal(bundle.mode, "awaiting_live_run");
  assert.equal(bundle.network, "eip155:84532");
  assert.deepEqual(bundle.operations, []);
});
