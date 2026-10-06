import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { prepareJob, verifyMedia } from './job.mjs';
import { json, save, newDir, runVideo, hash, fail } from './producer-io.mjs';
import { runCommand, startPreview, runtimeEnv } from './runtime.mjs';
import { probe } from './producer-operations.mjs';
const VERSION='producer-qa-2';
const IMPLEMENTATION=hash(await readFile(new URL(import.meta.url)));
export function riskFrames(target,risks=[]) {
  const count=target.fps*target.duration_seconds;
  const frames=new Set([0,count-1]);
  for(const r of risks){if(!Number.isFinite(r.time)||r.time<0||r.time>target.duration_seconds||typeof r.reason!=='string')fail('INVALID_RISK','Risk needs bounded time and reason');const f=Math.round(r.time*target.fps);for(const n of [f-1,f,f+1])if(n>=0&&n<count)frames.add(n);}
  return [...frames].sort((a,b)=>a-b);
}
async function freshSources(job,sources){if(JSON.stringify((await prepareJob(job)).sources)!==JSON.stringify(sources))fail('SOURCE_CHANGED','Source changed during QA');}
async function plan(o){
  const media=o.run?await runVideo(o.workspace,o.run):null;
  const prepared=o.job?await prepareJob(o.job):{job:{target:media.manifest.target},sources:media.manifest.sources??null};
  const build=o.job?await json(path.join(path.dirname(o.job),'build.json')):{risks:[]};
  if(o.job && (build.status!=='completed'||JSON.stringify(build.compiled_sources)!==JSON.stringify(prepared.sources)))fail('SOURCE_CHANGED','Risk planning requires an unchanged completed build');
  const additional=o.risks?await json(o.risks):[];
  if(!Array.isArray(additional))fail('INVALID_RISK','Risk input must be an array');
  const risks=[...(build.risks??[]),...additional],frames=riskFrames(prepared.job.target,risks);
  const out=await newDir(o.workspace,o.out);
  await save(path.join(out,'plan.json'),{schema_version:'1',check_version:VERSION,target:prepared.job.target,video_sha256:media?.sha256??null,sources:prepared.sources,risks,frames,coverage_review:'pending',full_frame_seek:false});
  return {status:'prepared',out,frames};
}
async function loadPlan(o,media){
  const p=await json(o.plan);
  if(p.check_version!==VERSION||JSON.stringify(p.target)!==JSON.stringify(media.manifest.target)||!Array.isArray(p.frames)||!p.frames.length)fail('INVALID_PLAN','Plan does not match target/version');
  if(p.video_sha256 && p.video_sha256!==media.sha256)fail('STALE_PLAN','Plan belongs to another encoded movie');
  if(!media.manifest.sources && p.video_sha256!==media.sha256)fail('STALE_PLAN','Packaged media requires a movie-bound plan');
  const count=p.target.fps*p.target.duration_seconds;
  if(p.frames.some(f=>!Number.isInteger(f)||f<0||f>=count)||new Set(p.frames).size!==p.frames.length)fail('INVALID_PLAN','Invalid or repeated sample frame');
  const required=riskFrames(p.target,p.risks??[]);
  if(required.some(f=>!p.frames.includes(f))||p.frames.some((f,i)=>i && f<=p.frames[i-1]))fail('INVALID_PLAN','Samples must be ordered and include all risk boundaries');
  if(media.manifest.sources&&JSON.stringify(p.sources)!==JSON.stringify(media.manifest.sources))fail('STALE_PLAN','Plan does not match render sources');
  return p;
}
async function sampled(o){
  const media=await runVideo(o.workspace,o.run),p=await loadPlan(o,media),prepared=await prepareJob(o.job);
  if(JSON.stringify(prepared.sources)!==JSON.stringify(p.sources))fail('STALE_PLAN','Job sources changed');
  const out=await newDir(o.workspace,o.out);await mkdir(path.join(out,'seek'));
  const report={check_version:VERSION,implementation_sha256:IMPLEMENTATION,status:'running',video_sha256:media.sha256,sources:prepared.sources,plan_sha256:hash(await readFile(o.plan)),samples:[],visual:'pending'};
  let preview,browser;const errors=[],blocked=[];
  try {
    preview=await startPreview(prepared.project,path.join(out,'preview.log'));
    browser=await puppeteer.launch({executablePath:runtimeEnv().PRODUCER_HEADLESS_SHELL_PATH,headless:true,args:['--no-sandbox','--disable-gpu']});
    report.browser=await browser.version();
    const page=await browser.newPage();await page.setViewport({width:p.target.width,height:p.target.height,deviceScaleFactor:1});
    page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
    page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&!['localhost','127.0.0.1'].includes(u.hostname)){blocked.push(u.origin);void r.abort();}else void r.continue();});
    await page.goto(preview.url,{waitUntil:'domcontentloaded'});
    const frame=await page.waitForFrame(f=>{try{return new URL(f.url()).pathname.endsWith('/preview');}catch{return false;}},{timeout:30000});
    await page.goto(frame.url(),{waitUntil:'domcontentloaded'});
    let ready=false;for(let i=0;i<60;i++){ready=await page.evaluate(()=>window.__playerReady===true&&typeof window.__player?.renderSeek==='function'&&Object.keys(window.__timelines??{}).length>0&&document.fonts.status==='loaded'&&[...document.images].every(i=>i.complete&&i.naturalWidth));if(ready)break;await delay(500);}
    if(!ready)fail('PREVIEW_NOT_READY','Timeline, images or fonts are not ready');
    const baselines=new Map();
    const capture=async(f,order)=>{await page.evaluate(async t=>{await window.__player.renderSeek(t);await document.fonts.ready;const raf=(window.__HF_VIRTUAL_TIME__?.originalRequestAnimationFrame??window.requestAnimationFrame).bind(window);await new Promise(r=>raf(()=>raf(r)));},f/p.target.fps);const file=`seek/${order}-${f}.png`;const bytes=await page.screenshot({path:path.join(out,file),type:'png'});const sha=hash(bytes);report.samples.push({order,frame:f,path:file,sha256:sha});return sha;};
    const coldFrame=p.frames.find(f=>f>0)??0,cold=await capture(coldFrame,'initial-nonzero');
    for(const f of p.frames)baselines.set(f,await capture(f,'forward'));
    if(cold!==baselines.get(coldFrame))fail('SEEK_MISMATCH','Initial nonzero seek differs from forward baseline');
    const shuffled=[...p.frames.filter((_,i)=>i%2),...p.frames.filter((_,i)=>i%2===0).reverse()];
    for(const [order,frames] of [['reverse',[...p.frames].reverse()],['shuffle',shuffled]])for(const f of frames)if(await capture(f,order)!==baselines.get(f))fail('SEEK_MISMATCH','Exact PNG bytes differ from forward baseline');
    if(errors.length||blocked.length)fail('PREVIEW_ERROR','Browser errors or blocked network requests');
    await freshSources(o.job,prepared.sources);if(hash(await readFile(media.file))!==media.sha256)fail('VIDEO_CHANGED','Video changed during QA');
    report.status='passed';report.exact_png_equality=true;
  }catch(e){report.status='failed';report.code=e.code??'ERROR';throw e;}
  finally{await browser?.close();await preview?.close();report.errors=errors;report.blocked=blocked;await save(path.join(out,'report.json'),report);}
  return {status:report.status,out,visual:'pending'};
}
async function encoded(o){
  const media=await runVideo(o.workspace,o.run),p=await loadPlan(o,media),out=await newDir(o.workspace,o.out);
  const report={check_version:VERSION,implementation_sha256:IMPLEMENTATION,status:'running',video_sha256:media.sha256,plan_sha256:hash(await readFile(o.plan)),frames:p.frames,visual:'pending'};
  try{const metadata=await probe(media.file);report.media=verifyMedia(metadata,media.manifest.target,media.manifest.expect_audio ?? (media.manifest.output.media?.audio_streams > 0));
    await runCommand('ffmpeg',['-v','error','-i',media.file,'-f','null','-'],{log:path.join(out,'full-decode.log')});
    await runCommand('ffmpeg',['-v','error','-i',media.file,'-vf',`select=${p.frames.map(f=>`eq(n\\,${f})`).join('+')}`,'-fps_mode','vfr',path.join(out,'frame-%04d.png')],{log:path.join(out,'frames.log')});
    if(hash(await readFile(media.file))!==media.sha256)fail('VIDEO_CHANGED','Video changed during QA');report.status='passed';
  }catch(e){report.status='failed';report.code=e.code??'ERROR';throw e;}finally{await save(path.join(out,'report.json'),report);}
  return {status:report.status,out,visual:'pending'};
}
async function playback(o){
  const media=await runVideo(o.workspace,o.run),out=await newDir(o.workspace,o.out);
  let browser,server;const report={check_version:VERSION,implementation_sha256:IMPLEMENTATION,status:'running',video_sha256:media.sha256,visual:'pending',listening:'not_performed',muted:true};
  try{
    browser=await puppeteer.launch({executablePath:runtimeEnv().PRODUCER_HEADLESS_SHELL_PATH,headless:true,args:['--no-sandbox','--disable-gpu']});
    report.environment={browser:await browser.version(),platform:process.platform,arch:process.arch,muted:true};
    if(o.reuse){const previous=await json(o.reuse);if(previous.status!=='passed'||previous.video_sha256!==media.sha256||previous.check_version!==VERSION||previous.implementation_sha256!==IMPLEMENTATION||JSON.stringify(previous.environment)!==JSON.stringify(report.environment)||previous.playback?.ended!==true)fail('STALE_PLAYBACK','Playback reuse requires identical video, check and environment');report.playback=previous.playback;report.reused_from=o.reuse;report.status='passed';}
    else{
      server=createServer((req,res)=>{if(req.url!=='/video.mp4'){res.writeHead(404).end();return;}const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);const start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),media.bytes.length-1):media.bytes.length-1;if(start>end||start>=media.bytes.length){res.writeHead(416).end();return;}const h={'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1};if(range)h['Content-Range']=`bytes ${start}-${end}/${media.bytes.length}`;res.writeHead(range?206:200,h).end(media.bytes.subarray(start,end+1));});
      await new Promise(r=>server.listen(0,'127.0.0.1',r));const page=await browser.newPage();
      await page.setContent(`<video muted src="http://127.0.0.1:${server.address().port}/video.mp4"></video>`);
      report.playback=await page.evaluate(async seconds=>{const v=document.querySelector('video');const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Playback timeout')),Math.max(15000,seconds*1000+10000));v.onended=()=>{clearTimeout(timer);resolve();};v.onerror=()=>{clearTimeout(timer);reject(new Error('Decode error'));};});await v.play();await done;const q=v.getVideoPlaybackQuality();return{ended:v.ended,duration_seconds:v.duration,error:v.error?.code??null,width:v.videoWidth,height:v.videoHeight,total_video_frames:q.totalVideoFrames,dropped_video_frames:q.droppedVideoFrames};},media.manifest.target.duration_seconds);
      if(!report.playback.ended||report.playback.error)fail('PLAYBACK_FAILED','Video did not finish');report.status='passed';
    }
    if(hash(await readFile(media.file))!==media.sha256)fail('VIDEO_CHANGED','Video changed during playback');
  }catch(e){report.status='failed';report.code=e.code??'ERROR';throw e;}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await save(path.join(out,'report.json'),report);}
  return {status:report.status,out,listening:'not_performed'};
}
export async function qa(action,o){if(action==='plan')return plan(o);if(action==='sample')return sampled(o);if(action==='encoded')return encoded(o);if(action==='playback')return playback(o);fail('INVALID_ACTION','Unknown QA action');}
