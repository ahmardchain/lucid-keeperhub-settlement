import {readFile} from 'node:fs/promises';
const bundle=JSON.parse(await readFile('public/evidence/receipts.json','utf8'));
const operations=bundle.operations??[];
const errors=[];
if(bundle.mode!=='base_sepolia_live'||bundle.network!=='eip155:84532')errors.push('Expected live Base Sepolia evidence bundle');
for(const field of ['operationId','lucidTaskId','keeperhubExecutionId','paymentTransactionHash','settlementTransactionHash']) {
 const values=operations.map(o=>o[field]);
 if(values.some(v=>typeof v!=='string'||!v)||new Set(values).size!==values.length)errors.push('Missing or duplicated '+field);
}
if(!operations.some(o=>o.direction==='payout')||!operations.some(o=>o.direction==='refund'))errors.push('Record both outcome paths');
let video;
try {video=new URL(process.env.DEMO_VIDEO_URL);if(video.protocol!=='https:')throw new Error();}catch{errors.push('Set DEMO_VIDEO_URL to the actual public HTTPS recording');}
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.CONTACT_EMAIL??''))errors.push('Set CONTACT_EMAIL');
if(!process.env.CONTACT_HANDLE?.trim())errors.push('Set CONTACT_HANDLE (X or Discord)');
console.log(JSON.stringify({recordedOperations:operations.length,payouts:operations.filter(o=>o.direction==='payout').length,refunds:operations.filter(o=>o.direction==='refund').length,metadataComplete:errors.length===0,errors,note:'Structural check only. Does not verify chain receipts, video accessibility, eligibility, or submit the entry.'},null,2));
if(errors.length)process.exitCode=1;
