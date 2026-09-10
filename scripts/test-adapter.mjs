import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// A separate consumer loads the unpacked distributable, never src/ imports.
const consumer = await mkdtemp(resolve(".release/consumer-"));
const packageDir = `${consumer}/node_modules/@ahmardchain/lucid-keeperhub-settlement`;
await mkdir(packageDir, { recursive: true });
execFileSync("tar", ["-xzf", resolve(".release/ahmardchain-lucid-keeperhub-settlement-0.1.0.tgz"), "--strip-components=1", "-C", packageDir]);
await writeFile(`${consumer}/package.json`, JSON.stringify({ type: "module" }));
await writeFile(`${consumer}/app.mjs`, `
import assert from 'node:assert/strict';
import { createSettlementAgentService, BASE_SEPOLIA_USDC } from '@ahmardchain/lucid-keeperhub-settlement';
globalThis.fetch = async () => Response.json({kinds:[{x402Version:2,scheme:'exact',network:'eip155:84532'}]});
const service = await createSettlementAgentService({
 port:8788, databasePath:'consumer.db', baseSepoliaRpcUrl:'https://rpc.test',
 baseSepoliaUsdcAddress:BASE_SEPOLIA_USDC, facilitatorUrl:'https://facilitator.test',
 keeperHubApiBaseUrl:'https://keeperhub.test', keeperHubApiKey:'kh_consumer_test',
 settlementAddress:'0x1111111111111111111111111111111111111111', taskPriceAtomic:'10000', taskDeadlineMs:60000,
});
try {
 const response = await service.app.fetch(new Request('http://consumer.test/api/settlements'));
 assert.equal(response.status,200);
 assert.deepEqual((await response.json()).operations,[]);
 console.log('Separate consumer instantiated the packaged Lucid service successfully');
} finally { await service.close(); }
`);
const output = execFileSync(process.execPath, ["app.mjs"], { cwd: consumer, encoding: "utf8" });
assert.match(output, /successfully/);
console.log(output.trim());
