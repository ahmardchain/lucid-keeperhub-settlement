import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const consumer=await mkdtemp(join(tmpdir(),'lucid-consumer-'));
await writeFile(join(consumer,'package.json'),JSON.stringify({name:'invoice-consumer',private:true,type:'module'}));
// A clean directory outside the source tree prevents parent node_modules from
// masking missing package dependencies. No source imports or copied modules.
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--ignore-scripts','--no-audit','--no-fund','--fetch-retries=0','--fetch-timeout=15000',resolve('.release/ahmardchain-lucid-keeperhub-settlement-0.1.0.tgz')],{cwd:consumer,stdio:'inherit'});
await copyFile('examples/invoice-consumer/app.mjs',join(consumer,'app.mjs'));
execFileSync(process.execPath,['app.mjs'],{cwd:consumer,stdio:'inherit'});
