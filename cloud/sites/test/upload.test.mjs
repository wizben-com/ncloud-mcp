import assert from 'node:assert/strict';
import test from 'node:test';
import { configuration, submission, createWorker } from '../worker/index.js';
import { fetchMediaUpload, MAX_MEDIA_BYTES } from '../worker/remote-upload.js';
import { SqliteD1 } from './sqlite-d1.mjs';
const env = {NCLOUD_SPEECH_ENABLED:'true',NCLOUD_SPEECH_INVOKE_URL:'https://clovaspeech-gw.ncloud.com/external/v1/0000/SYNTHETIC',NCLOUD_SPEECH_SECRET:'SYNTHETIC_TEST_SECRET',NCLOUD_SPEECH_UPLOAD_URL_HOSTS:'media.example.com',NCLOUD_SPEECH_ALLOW_ASYNC_OBS:'true'};
const args = {request_id:'upload-test-001',source:'upload_url',location:'https://media.example.com/audio.JYZ?token=SYNTHETIC',filename:'recording.ogg',result_to_obs:true};
const spec = submission(args,configuration(env));
globalThis.fetch = () => {throw Error('No live calls');};
test('upload source uses separate allowlist, supported filename and no paths',()=>{
  assert.equal(spec.endpoint,'/recognizer/upload');
  for (const replacement of [{filename:'../a.ogg'},{filename:'a.exe'},{filename:undefined},{location:'https://other.example.com/a.ogg'},{location:'https://media.example.com/a#secret'},{location:'http://media.example.com/a'}]) assert.throws(()=>submission({...args,...replacement},configuration(env)));
  assert.throws(()=>submission(args,configuration({...env,NCLOUD_SPEECH_UPLOAD_URL_HOSTS:''})));
  assert.throws(()=>submission({...args,source:'url'},configuration(env)));
});
test('multipart preserves bytes and params; no source cookie or Speech secret', async()=>{
  const form = await fetchMediaUpload(spec.body,async(url,init)=>{
    assert.equal(url,args.location); assert.equal(init.redirect,'manual');
    assert.equal(Object.keys(init.headers).length,1);
    return new Response(new Uint8Array([79,103,103,83]));
  });
  assert.deepEqual([...new Uint8Array(await form.get('media').arrayBuffer())],[79,103,103,83]);
  assert.equal(form.get('media').name,'recording.ogg');
  assert.equal(JSON.parse(form.get('params')).completion,'async');
});
test('redirect, empty, declared and streamed oversize media fail closed',async()=>{
  for (const make of [()=>new Response(null,{status:302,headers:{location:'https://evil.example.com'}}),()=>new Response(''),()=>new Response('x',{headers:{'content-length':String(MAX_MEDIA_BYTES+1)}}),()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_MEDIA_BYTES+1));c.close();}}))]) await assert.rejects(fetchMediaUpload(spec.body,async()=>make()));
});
test('durable duplicate upload requests make one media GET and one provider POST',async()=>{
  const DB=new SqliteD1(); let gets=0,posts=0;
  try {
    const worker=createWorker({fetchImpl:async(url,init)=>{
      if(init.method==='GET'){gets++; assert.equal(url,args.location);return new Response(new TextEncoder().encode('OggSsynthetic audio')); }
      posts++;assert.ok(url.endsWith('/recognizer/upload'));assert.ok(init.body instanceof FormData);
      assert.equal(init.headers['Content-Type'],undefined);
      return Response.json({result:'SUCCEEDED',token:'synthetic-token'});
    }});
    async function call(input){return (await (await worker.fetch(new Request('https://site.example/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'clova_speech_submit_async',arguments:input}})}),{...env,DB})).json()).result;}
    const one=await call(args),two=await call(args);
    assert.equal(one.isError,false);assert.equal(two.isError,false);
    assert.equal(one.structuredContent.job_id,two.structuredContent.job_id);
    assert.equal(gets,1);assert.equal(posts,1);
    assert.ok(!JSON.stringify(one).includes('SYNTHETIC'));
  } finally {DB.close();}
});
test('source failure is sanitized and never submitted or retried',async()=>{
  const DB=new SqliteD1();let calls=0;
  try {
    const worker=createWorker({fetchImpl:async()=>{calls++;throw Error(args.location);}});
    const req=()=>new Request('https://site.example/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'clova_speech_submit_async',arguments:args}})});
    const one=await(await worker.fetch(req(),{...env,DB})).text();
    await worker.fetch(req(),{...env,DB});assert.equal(calls,1);
    assert.ok(!one.includes(args.location));assert.ok(one.includes('UNKNOWN'));
  } finally {DB.close();}
});
test('HTML response, disguised Ogg and expired cancellation fail before provider',async()=>{
  await assert.rejects(fetchMediaUpload(spec.body,async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})));
  await assert.rejects(fetchMediaUpload(spec.body,async()=>new Response(new Uint8Array([1,2,3]))));
  const signal=AbortSignal.abort();
  await assert.rejects(fetchMediaUpload(spec.body,async()=>new Response(new TextEncoder().encode('OggS')),signal));
});
test('late source after deadline cannot issue billable POST; concurrent upload is refused before claim',async()=>{
  const DB=new SqliteD1(); let release; let posts=0,gets=0;
  const wait=new Promise(r=>{release=r;});
  try {
    const worker=createWorker({uploadTimeoutMs:10,fetchImpl:async(url,init)=>{
      if(init.method==='POST'){posts++;return Response.json({result:'SUCCEEDED',token:'synthetic-token'});}
      gets++;await wait;return new Response(new TextEncoder().encode('OggS'));
    }});
    const req=(id)=>new Request('https://site.example/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'clova_speech_submit_async',arguments:{...args,request_id:id}}})});
    const first=worker.fetch(req('deadline-test-1'),{...env,DB});
    while(!gets) await new Promise(r=>setTimeout(r,1));
    const concurrent=await(await worker.fetch(req('deadline-test-2'),{...env,DB})).text();
    assert.match(concurrent,/UPLOAD_BUSY/);
    await first;release();await new Promise(r=>setTimeout(r,5));
    assert.equal(posts,0);
    assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM ncloud_speech_jobs').get().n,1);
  } finally {release();DB.close();}
});
