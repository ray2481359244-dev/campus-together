// A loopback protocol fixture; this never calls a real model or verifies its quality.
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { DraftFieldsSchema } from '../packages/contracts/src/assistance.js';
import { callModel,validateDraft } from '../apps/server/src/ai-adapter.js';
const text='一起完成校园比赛作品，日期人数待确认。';let calls=0;
const server=createServer(async(req,res)=>{
  try { assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,'Bearer protocol-fixture-key');
    let body='';for await(const chunk of req)body+=chunk;const parsed=JSON.parse(body);assert.equal(parsed.response_format.type,'json_schema');assert.equal(parsed.response_format.json_schema.strict,true);assert.equal(parsed.model,'protocol-fixture');assert.equal(parsed.store,false);assert.equal(parsed.tools,undefined);calls++;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({fields:[{field:'description',value:text,sourceExcerpt:text}],missingQuestions:[]})}}]}));
  }catch{res.writeHead(400);res.end('{}');}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
try {const address=server.address();assert(address&&typeof address!=='string');Object.assign(process.env,{AI_MODE:'LIVE',AI_BASE_URL:`http://127.0.0.1:${address.port}/v1`,AI_MODEL:'protocol-fixture',AI_API_KEY:'protocol-fixture-key'});
  const result=validateDraft(text,await callModel(DraftFieldsSchema,'Extract exact source text.',{text}));assert.equal(result.fields[0].value,text);assert.equal(calls,1);
  console.log(JSON.stringify({passed:true,loopbackProtocolFixture:true,structuredRequestAndGroundedResponse:true,realModelInvoked:false}));
}finally{server.closeIdleConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
