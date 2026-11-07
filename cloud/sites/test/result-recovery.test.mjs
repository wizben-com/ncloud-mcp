import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorker} from '../worker/index.js';
import {SqliteD1,seedAccepted} from './sqlite-d1.mjs';
globalThis.fetch=()=>{throw Error('No live network');};
const env={NCLOUD_SPEECH_ENABLED:'true',NCLOUD_SPEECH_INVOKE_URL:'https://clovaspeech-gw.ncloud.com/external/v1/0000/SYNTHETIC',NCLOUD_SPEECH_SECRET:'SYNTHETIC_SECRET',NCLOUD_SPEECH_UPLOAD_URL_HOSTS:'media.example.com',NCLOUD_SPEECH_ALLOW_ASYNC_OBS:'true'};
const storage={NCLOUD_SPEECH_RESULT_STORAGE_ENABLED:'true',NCLOUD_SPEECH_RESULT_BUCKET:'synthetic-results',NCLOUD_SPEECH_RESULT_PREFIX:'results/',NCLOUD_SPEECH_RESULT_ACCESS_KEY:'SYNTHETIC_ACCESS',NCLOUD_SPEECH_RESULT_SECRET_KEY:'SYNTHETIC_SECRET'};
async function call(worker,bindings,name,args,owner='synthetic-owner'){
 return (await(await worker.fetch(new Request('https://example.com/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),bindings)).json()).result;
}
test('completed without transcript distinguishes processing success from result availability',async()=>{
 const DB=new SqliteD1();try{
  const bindings={...env,DB},job_id=await seedAccepted(bindings);
  const server=createWorker({fetchImpl:async()=>Response.json({result:'COMPLETED',segments:[]})});
  const status=await call(server,bindings,'clova_speech_job_status',{job_id});
  assert.equal(status.isError,false);assert.equal(status.structuredContent.result_available,false);
  assert.equal(status.structuredContent.result_retrieval_required,true);
  assert.deepEqual(status.structuredContent.fields_present,{text:false,segments:true});
  assert.equal(status.structuredContent.text,undefined);
  const page=await call(server,bindings,'clova_speech_job_result_page',{job_id});
  assert.equal(page.isError,true);assert.match(page.content[0].text,/RESULT_CONTENT_NOT_RETURNED/);
  assert.equal(page.structuredContent.job_id,job_id);
 }finally{DB.close();}
});
test('known storage key can recover matching result; wrong owner/token never reveals transcript',async()=>{
 const DB=new SqliteD1();try{
  const bindings={...env,...storage,DB},job_id=await seedAccepted(bindings);let calls=0;
  const server=createWorker({fetchImpl:async(url,init)=>{calls++;assert.equal(init.method,'GET');assert.match(url,/kr.object.ncloudstorage.com/);return Response.json({result:'SUCCEEDED',token:'synthetic-token',text:'Safe test result',segments:[]});}});
  const wrong=await call(server,bindings,'clova_speech_job_result_page',{job_id,object_key:'results/test.json'},'other-owner');assert.equal(wrong.isError,true);assert.equal(calls,0);
  const ok=await call(server,bindings,'clova_speech_job_result_page',{job_id,object_key:'results/test.json',limit:4});
  assert.equal(ok.isError,false);assert.equal(ok.structuredContent.text,'Safe');assert.equal(ok.structuredContent.next_offset,4);assert.equal(ok.structuredContent.result_source,'object_storage');assert.equal(ok.structuredContent.provider_state,'COMPLETED');
  assert.ok(!JSON.stringify(ok).includes('synthetic-token'));
  const envelope=createWorker({fetchImpl:async()=>Response.json({result:'SUCCEEDED',token:'synthetic-token'})});
  assert.equal((await call(envelope,bindings,'clova_speech_job_result_page',{job_id,object_key:'results/test.json'})).isError,true);
  const mismatch=createWorker({fetchImpl:async()=>Response.json({result:'COMPLETED',token:'other-token',text:'SECRET_OTHER_JOB'})});
  const denied=await call(mismatch,bindings,'clova_speech_job_result_page',{job_id,object_key:'results/other.json'});assert.equal(denied.isError,true);assert.ok(!JSON.stringify(denied).includes('SECRET_OTHER_JOB'));
 }finally{DB.close();}
});
test('verified operator template enables fallback, no default key is guessed',async()=>{
 const DB=new SqliteD1();try{
  const bindings={...env,...storage,DB},job_id=await seedAccepted(bindings);let reads=0;
  const server=createWorker({fetchImpl:async(url)=>{reads++;return Response.json(url.includes('/recognizer/')?{result:'COMPLETED',segments:[]}:{result:'COMPLETED',token:'synthetic-token',text:'Recovered'});}});
  const absent=await call(server,bindings,'clova_speech_job_result_page',{job_id});assert.equal(absent.isError,true);assert.equal(reads,1);
  bindings.NCLOUD_SPEECH_RESULT_KEY_TEMPLATE='results/{token}.json';
  const recovered=await call(server,bindings,'clova_speech_job_result_page',{job_id});assert.equal(recovered.isError,false);assert.equal(recovered.structuredContent.text,'Recovered');assert.equal(reads,3);
  const health=await call(server,bindings,'ncloud_cloud_health',{});assert.equal(health.structuredContent.ready_for_async_submission,true);assert.equal(health.structuredContent.ready_for_async_transcription,true);
  const unconfigured=await call(server,{...env,DB},'ncloud_cloud_health',{});assert.equal(unconfigured.structuredContent.ready_for_async_submission,true);assert.equal(unconfigured.structuredContent.ready_for_async_transcription,false);
 }finally{DB.close();}
});
