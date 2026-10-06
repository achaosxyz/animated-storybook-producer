import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse, main } from '../../producer.mjs';
import { output, input, bound, hash } from '../src/producer-io.mjs';
import { riskFrames } from '../src/producer-qa.mjs';
import { execute } from '../src/producer-operations.mjs';

test('public CLI requires explicit workspace/out/job and rejects unknown duplicate flags',()=>{
 for(const args of [['render'],['build','--workspace','/tmp'],['inspect','--workspace','/tmp','--workspace','/tmp'],['inspect','--workspace','/tmp','--key','secret'],['tts','check','--workspace','/tmp']]) assert.throws(()=>parse(args));
 assert.equal(parse(['tts','synthesize','--workspace','/tmp','--job','voice.json','--out','new','--allow-paid']).opts['allow-paid'],true);
 assert.equal(parse(['inspect','--workspace','.']).opts.workspace,process.cwd());
});
test('workspace boundary rejects symlink escapes and existing outputs',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'producer-boundary-'));const other=await mkdtemp(path.join(os.tmpdir(),'producer-outside-'));
 try {await symlink(other,path.join(root,'escape'));await assert.rejects(output(root,path.join(root,'escape','new')),{code:'PATH_ESCAPE'});await assert.rejects(output(root,root));await assert.rejects(input(root,path.join(root,'escape')),{code:'PATH_ESCAPE'});await writeFile(path.join(root,'a'),'data');await assert.rejects(bound(root,root,{path:'a',sha256:'0'.repeat(64)}),{code:'SOURCE_CHANGED'});}
 finally{await rm(root,{recursive:true,force:true});await rm(other,{recursive:true,force:true});}
});
test('risk plan covers both sides without out-of-range or all-frame default',()=>{
 const frames=riskFrames({fps:30,duration_seconds:4},[{time:2,reason:'contact'}]);assert.deepEqual(frames,[0,59,60,61,119]);assert.throws(()=>riskFrames({fps:30,duration_seconds:4},[{time:5,reason:'bad'}]));
});
test('inspect preserves pending approvals and limits repair rounds',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'producer-state-'));
 try{const f=path.join(root,'state.json');await writeFile(f,JSON.stringify({issues:[{repair_rounds:6}]}));await assert.rejects(execute('inspect',{workspace:root,state:f}),{code:'INVALID_STATE'});await writeFile(f,JSON.stringify({issues:[{repair_rounds:5}],next:'blocked'}));const r=await execute('inspect',{workspace:root,state:f});assert.equal(r.approval,'not-inferred');assert.equal(r.next,'blocked');}finally{await rm(root,{recursive:true,force:true});}
});
test('build rejects missing assets, source hashes and invalid schema before output',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'producer-build-'));
 try{const f=path.join(root,'input.json'),out=path.join(root,'out');await writeFile(f,JSON.stringify({schema_version:'wrong'}));await assert.rejects(execute('build',{workspace:root,input:f,out}),{code:'INVALID_BUILD'});}
 finally{await rm(root,{recursive:true,force:true});}
});

test('outputs cannot be written into the installed skill',async()=>{
 const skill=path.resolve(import.meta.dirname,'../../..');
 await assert.rejects(output(path.dirname(skill),path.join(skill,'new-output')),{code:'OUTPUT_IN_SKILL'});
});
test('build normalizes framework IDs before hashing, preserves source and rejects stale compiled content',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'producer-normalize-'));
 try {
  const html='<!doctype html><html><head><script src="vendor/gsap.min.js"></script></head><body><div data-composition-id="normalization" data-width="720" data-height="1280" data-duration="1"><div id="shape">Test</div></div><script>window.__timelines["normalization"]=gsap.timeline({paused:true});</script></body></html>';
  await writeFile(path.join(root,'source.html'),html);
  const d={schema_version:'1',mode:'composition',id:'normalization',artifact_version:'normalization-v1',purpose:'technical_validation',target:{width:720,height:1280,fps:30,duration_seconds:1},files:[{path:'source.html',sha256:hash(Buffer.from(html)),dest:'index.html'}]};
  const file=path.join(root,'input.json'),out=path.join(root,'build');await writeFile(file,JSON.stringify(d));
  await execute('build',{workspace:root,input:file,out});
  const normalized=await readFile(path.join(out,'index.html'),'utf8');assert.match(normalized,/data-hf-id=/);assert.equal(await readFile(path.join(root,'source.html'),'utf8'),html);
  const { runHyperframes }=await import('../src/runtime.mjs');await runHyperframes(['timeline','ids','--dir',out,'--json']);assert.equal(await readFile(path.join(out,'index.html'),'utf8'),normalized);
  await writeFile(path.join(out,'index.html'),normalized+'<!--changed-->');
  await assert.rejects(main(['check','--workspace',root,'--job',path.join(out,'job.json'),'--out',path.join(root,'check')]),{code:'SOURCE_CHANGED'});
 } finally {await rm(root,{recursive:true,force:true});}
});

test('qa plan selects exactly one source and realpath outputs cannot alias the skill',async()=>{
 assert.throws(()=>parse(['qa','plan','--workspace','/tmp','--out','/tmp/new']));
 assert.throws(()=>parse(['qa','plan','--workspace','/tmp','--job','/tmp/a','--run','/tmp/b','--out','/tmp/new']));
 assert.equal(parse(['qa','plan','--workspace','/tmp','--run','/tmp/b','--out','/tmp/new']).action,'qa plan');
 const skill=path.resolve(import.meta.dirname,'../../..'),root=path.dirname(skill),temp=await mkdtemp(path.join(root,'test-alias-'));
 try{await symlink(skill,path.join(temp,'alias'));await assert.rejects(output(root,path.join(temp,'alias','new-output')),{code:'OUTPUT_IN_SKILL'});}finally{await rm(temp,{recursive:true,force:true});}
});
test('deliver rejects missing playback and mismatched review instead of inventing success',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'producer-review-'));
 try{
  const run=path.join(root,'run');await mkdir(run);const bytes=Buffer.from('fake media');await writeFile(path.join(run,'output.mp4'),bytes);
  await writeFile(path.join(run,'manifest.json'),JSON.stringify({status:'completed',output:{path:'output.mp4',sha256:hash(bytes)}}));
  const review=path.join(root,'review.json');await writeFile(review,JSON.stringify({video_sha256:'0'.repeat(64)}));
  await assert.rejects(execute('deliver',{workspace:root,run,review,out:path.join(root,'delivery')}),{code:'STALE_REVIEW'});
  await writeFile(review,JSON.stringify({video_sha256:hash(bytes)}));
  await assert.rejects(execute('deliver',{workspace:root,run,review,out:path.join(root,'delivery')}),{code:'INVALID_ASSET'});
 }finally{await rm(root,{recursive:true,force:true});}
});
