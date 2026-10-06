import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execute } from '../src/producer-operations.mjs';
import { hash } from '../src/producer-io.mjs';
import { pcmWave } from '../src/audio.mjs';
import { runCommand } from '../src/runtime.mjs';

const target={width:720,height:1280,fps:30,duration_seconds:1};
async function fixture(root,body,extra={}) {
 const html=`<!DOCTYPE html><HTML><HEAD><script src="vendor/gsap.min.js"></script></HEAD><BODY><div data-composition-id="review" data-width="720" data-height="1280" data-duration="1">${body}</div><script>window.__timelines['review']=gsap.timeline({paused:true});</script></BODY></HTML>`;
 await writeFile(path.join(root,'source.html'),html);await writeFile(path.join(root,'voice.wav'),pcmWave(Buffer.alloc(48000),24000));
 const bind=async name=>({path:name,sha256:hash(await readFile(path.join(root,name)))});
 const d={schema_version:'1',mode:'composition',id:'review',artifact_version:'review-v1',purpose:'technical_validation',target,files:[{...await bind('source.html'),dest:'index.html'}],audio:await bind('voice.wav'),...extra};
 const input=path.join(root,'input.json');await writeFile(input,JSON.stringify(d));return {workspace:root,input,out:path.join(root,'build')};
}
test('audio-only composition imports uppercase HTML without silently losing the track',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'review-audio-'));
 try {const o=await fixture(root,'');await execute('build',o);const html=await readFile(path.join(o.out,'index.html'),'utf8');assert.match(html,/<audio\b/);}
 finally {await rm(root,{recursive:true,force:true});}
});
test('audio-only import rejects existing audio just like the subtitle branch',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'review-audio-existing-'));
 try {const o=await fixture(root,'<audio id="existing" src="assets/voice-track.wav"></audio>');await assert.rejects(execute('build',o),{code:'ALREADY_HAS_AUDIO'});}
 finally {await rm(root,{recursive:true,force:true});}
});
test('a run-based QA plan binds the actual movie, not only dimensions/duration',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'review-plan-'));
 try {const run=path.join(root,'run');await mkdir(run);const bytes=Buffer.from('fixture');await writeFile(path.join(run,'output.mp4'),bytes);await writeFile(path.join(run,'manifest.json'),JSON.stringify({status:'completed',target,output:{path:'output.mp4',sha256:hash(bytes)}}));
 const out=path.join(root,'plan');await execute('qa plan',{workspace:root,run,out});const p=JSON.parse(await readFile(path.join(out,'plan.json')));assert.equal(p.video_sha256,hash(bytes));
 p.video_sha256='0'.repeat(64);await writeFile(path.join(out,'plan.json'),JSON.stringify(p));await assert.rejects(execute('qa encoded',{workspace:root,run,plan:path.join(out,'plan.json'),out:path.join(root,'encoded')}),{code:'STALE_PLAN'});
 } finally {await rm(root,{recursive:true,force:true});}
});
test('explicit normalize packaging adds a silent audio stream for a silent outro',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'review-package-'));
 try {
  await runCommand('ffmpeg',['-v','error','-f','lavfi','-i','color=c=navy:s=64x64:r=30:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',path.join(root,'body.mp4')]);
  await runCommand('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=64x64:r=30:d=1','-c:v','libx264','-pix_fmt','yuv420p',path.join(root,'outro.mp4')]);
  const parts=await Promise.all(['body.mp4','outro.mp4'].map(async name=>({path:name,sha256:hash(await readFile(path.join(root,name)))})));
  const input=path.join(root,'package.json');await writeFile(input,JSON.stringify({schema_version:'1',mode:'normalize',parts}));
  const out=path.join(root,'package');await execute('package',{workspace:root,input,out});const m=JSON.parse(await readFile(path.join(out,'manifest.json')));assert.equal(m.expect_audio,true);assert.equal(m.target.duration_seconds,2);assert.equal(m.mode,'normalize');
  const report={status:'passed',video_sha256:m.output.sha256,playback:{ended:true},fixture:true};
  await writeFile(path.join(root,'playback-fixture.json'),JSON.stringify(report));
  const review=path.join(root,'review.json');await writeFile(review,JSON.stringify({video_sha256:m.output.sha256,playback:{path:'playback-fixture.json',sha256:hash(await readFile(path.join(root,'playback-fixture.json')))},visual:'pending',listening:'not_performed',known_limits:['Unit fixture, not real playback evidence']}));
  const delivery=path.join(root,'delivery');await execute('deliver',{workspace:root,run:out,review,out:delivery});
  const receipt=JSON.parse(await readFile(path.join(delivery,'delivery.json')));assert.equal(receipt.review.playback.path,'qa/playback.json');assert.equal(hash(await readFile(path.join(delivery,receipt.review.playback.path))),receipt.review.playback.sha256);
  const declared=JSON.parse(await readFile(review));
  for(const invalid of [{visual:'approved'},{listening:true},{visual:{}},{known_limits:[{}]},{known_limits:[' ']}]) {
   await writeFile(review,JSON.stringify({...declared,...invalid}));
   await assert.rejects(execute('deliver',{workspace:root,run:out,review,out:path.join(root,'invalid-delivery')}),{code:'INVALID_REVIEW'});
  }
  await writeFile(review,JSON.stringify({...declared,known_limits:[]}));
  const pending=path.join(root,'pending-delivery');await execute('deliver',{workspace:root,run:out,review,out:pending});
  const viewer=await readFile(path.join(pending,'index.html'),'utf8');
  assert.match(viewer,/Visual review<\/dt><dd>pending/);assert.match(viewer,/Listening review<\/dt><dd>not_performed/);assert.match(viewer,/User approval: pending/);
  assert.equal(JSON.parse(await readFile(path.join(pending,'delivery.json'))).gate_c,null);
  await writeFile(review,JSON.stringify({...declared,visual:'failed',known_limits:['<script>bad()</script>']}));
  const failed=path.join(root,'failed-review-copy');await execute('deliver',{workspace:root,run:out,review,out:failed});
  const failedViewer=await readFile(path.join(failed,'index.html'),'utf8');assert.match(failedViewer,/Visual review<\/dt><dd>failed/);assert.doesNotMatch(failedViewer,/<script>/);assert.match(failedViewer,/&lt;script&gt;/);

 } finally {await rm(root,{recursive:true,force:true});}
});

test('package rejects an unknown mode instead of silently choosing an encoding path',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'review-mode-'));
 try {const input=path.join(root,'package.json');await writeFile(input,JSON.stringify({schema_version:'1',mode:'normalise-typo',parts:[{}]}));await assert.rejects(execute('package',{workspace:root,input,out:path.join(root,'out')}),{code:'INVALID_PACKAGE'});}
 finally {await rm(root,{recursive:true,force:true});}
});
test('composition-owned audio can be declared without injecting a duplicate track',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'review-own-audio-'));
 try {const o=await fixture(root,'<audio id="existing" src="voice.wav"></audio>',{audio:undefined,expect_audio:true});const d=JSON.parse(await readFile(o.input));d.files.push({path:'voice.wav',sha256:hash(await readFile(path.join(root,'voice.wav'))),dest:'voice.wav'});await writeFile(o.input,JSON.stringify(d));await execute('build',o);const j=JSON.parse(await readFile(path.join(o.out,'job.json')));assert.equal(j.expect_audio,true);}
 finally {await rm(root,{recursive:true,force:true});}
});
