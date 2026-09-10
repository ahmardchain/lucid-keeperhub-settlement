// Executable integration contract: real Lucid runtime, deterministic invoice
// capability, packaged settlement adapter. Payment and KeeperHub are fixtures.
import assert from 'node:assert/strict';
import {createAgent} from '@lucid-agents/core';
import {a2a} from '@lucid-agents/a2a';
import {http} from '@lucid-agents/http';
import {createAgentApp} from '@lucid-agents/hono';
import {z} from 'zod';
import {SettlementCoordinator, SqliteSettlementStore, SqliteTaskStore, withOutputVerifier, BASE_SEPOLIA_USDC} from '@ahmardchain/lucid-keeperhub-settlement';
const settlement = '0x' + '11'.repeat(20), worker = '0x' + '22'.repeat(20), payer = '0x' + '33'.repeat(20);
const taskStore = new SqliteTaskStore({databasePath:'consumer.db'});
const store = new SqliteSettlementStore('consumer.db');
const broadcasts = [];
const coordinator = new SettlementCoordinator({
  store, settlementAddress:settlement, usdcAddress:BASE_SEPOLIA_USDC,
  verifier:withOutputVerifier('invoice-totals/v1', output => output?.balanced === true && output?.totalCents > 0),
  executor:{
    async simulate(){return {success:true,wouldRevert:false,fromAddress:settlement,observedAt:new Date().toISOString()};},
    async execute(request){broadcasts.push(request);return {keeperhubExecutionId:'fixture-'+request.operationId,status:'completed',transactionHash:'0x'+'66'.repeat(32),receiptVerified:true,receiptStatus:'success',observedAt:new Date().toISOString()};},
    async getExecution(){throw new Error('Unexpected poll');},
  },
});
const runtime = await createAgent({name:'Invoice validation',version:'1.0.0',description:'Checks invoice totals before payment release'})
 .use(a2a({tasks:{store:taskStore}})).use(http({basePath:'/api/agent'}))
 .addEntrypoint({key:'validate_invoice',description:'Deterministically checks invoice arithmetic',
   input:z.object({items:z.array(z.object({quantity:z.number().int().positive(),unitCents:z.number().int().positive()})).min(1),claimedCents:z.number().int()}),
   output:z.object({totalCents:z.number().int(),balanced:z.boolean()}),
   handler:async({input})=>{const totalCents=input.items.reduce((sum,item)=>sum+item.quantity*item.unitCents,0);return {output:{totalCents,balanced:totalCents===input.claimedCents}};},
 }).build();
const {app}=await createAgentApp(runtime);
try {
 for (const [index,claimedCents] of [2500,2501].entries()) {
  const operationId='invoice-consumer-'+index;
  const response=await app.fetch(new Request('http://consumer/api/agent/tasks',{method:'POST',headers:{'Content-Type':'application/json','Task-Access-Token':'invoice-consumer-access-token-'+index},body:JSON.stringify({skillId:'validate_invoice',message:{role:'user',content:{text:JSON.stringify({items:[{quantity:2,unitCents:1250}],claimedCents})}}})}));
  assert.equal(response.status,200,await response.clone().text());
  const access=await response.json();
  const now=new Date();
  await coordinator.reserve({task:{operationId,lucidTaskId:access.taskId,lucidRunId:access.taskId,entrypoint:'validate_invoice',reservedAt:now.toISOString(),deadlineAt:new Date(now.getTime()+60000).toISOString()},payment:{network:'eip155:84532',assetAddress:BASE_SEPOLIA_USDC,amountAtomic:'10000',payerAddress:payer,settlementAddress:settlement,paymentTransactionHash:'0x'+String(44+index).repeat(32),facilitatorReference:'fixture'},workerAddress:worker});
  let stored;
  for(let poll=0;poll<100;poll++){stored=await taskStore.getDirect(access.taskId);if(stored?.task.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(stored.task.status,'completed');
  const evidence={operationId,lucidTaskId:access.taskId,lucidRunId:access.taskId,entrypoint:'validate_invoice',status:stored.task.status,reservedAt:now.toISOString(),deadlineAt:new Date(now.getTime()+60000).toISOString(),completedAt:stored.task.updatedAt,output:stored.task.result.output};
  const result=await coordinator.settle(evidence);
  assert.equal(result.direction,index===0?'payout':'refund');
  await coordinator.settle(evidence);
  assert.equal(broadcasts.length,index+1,'replay must not broadcast twice');
 }
 assert.equal(broadcasts[0].recipientAddress,worker);
 assert.equal(broadcasts[1].recipientAddress,payer);
 console.log('Invoice consumer passed: real Lucid tasks, custom verifier, payout, refund and replay. External money services were fixtures.');
} finally {await runtime.close();store.close();}
