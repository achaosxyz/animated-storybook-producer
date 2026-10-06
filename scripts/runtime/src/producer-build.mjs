import path from 'node:path';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { FACTORY, validateJob, prepareJob, localPath } from './job.mjs';
import { json, bound, newDir, save, finite, fail, hash } from './producer-io.mjs';
import { validateSubtitles, subtitleDisplayEnd, subtitleText } from './subtitles.mjs';
import { runHyperframes, runCommand } from './runtime.mjs';
import { withVoiceLayers } from './voice-attach.mjs';
const slug = x => { if (!/^[a-z][a-z0-9-]{0,63}$/.test(x ?? '')) fail('INVALID_ID','Expected a unique slug'); return x; };
export async function build(o) {
  const inputBytes = await readFile(o.input), d = JSON.parse(inputBytes), base = path.dirname(o.input);
  if (d.schema_version !== '1' || !['sprites','composition'].includes(d.mode)) fail('INVALID_BUILD','Expected build schema 1 and sprites/composition mode');
  const job = validateJob({schema_version:'0.1',id:d.id,artifact_version:d.artifact_version,purpose:d.purpose,project:'.',target:d.target,assets:['vendor/gsap.min.js'],expect_audio:!!d.audio});
  const sources = [];
  async function load(e) { const b = await bound(o.workspace,base,e); sources.push({path:path.relative(o.workspace,b.file),sha256:b.sha256}); return b.bytes; }
  const copies = new Map();
  for (const e of d.files ?? []) {
    if (typeof e.dest !== 'string') fail('INVALID_BUILD','Every copied file needs dest');
    localPath('/virtual',e.dest);
    if (['job.json','build.json','vendor/gsap.min.js'].includes(e.dest) || copies.has(e.dest)) fail('DUPLICATE_FILE','Reserved or repeated destination');
    copies.set(e.dest,await load(e));
  }
  let html, risks = [];
  if (d.mode === 'composition') {
    if (!copies.has('index.html')) fail('INVALID_BUILD','Composition mode needs an index.html file');
    html = copies.get('index.html').toString('utf8'); copies.delete('index.html');
  } else {
    if (!Array.isArray(d.scenes) || !d.scenes.length || !Array.isArray(d.assets)) fail('INVALID_BUILD','Sprite mode needs scenes and assets');
    const assets = new Map();
    for (const a of d.assets) {
      slug(a.id); if (assets.has(a.id)) fail('DUPLICATE_ASSET','Repeated asset ID');
      if (!['background','character-pose','contact-group','prop','state','shadow','foreground'].includes(a.role)) fail('INVALID_ASSET','Unsupported semantic asset unit');
      for (const k of ['width','height']) finite(a[k],1,16384);
      if (!Array.isArray(a.pivot) || a.pivot.length!==2) fail('INVALID_PIVOT','Expected local pixel pivot');
      finite(a.pivot[0],-32768,32768); finite(a.pivot[1],-32768,32768);
      const bytes = await load(a);
      if (bytes.length < 24 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.readUInt32BE(16)!==a.width || bytes.readUInt32BE(20)!==a.height) fail('INVALID_PNG','PNG dimensions do not match asset metadata');
      const dest=`assets/${a.id}.png`; if(copies.has(dest))fail('DUPLICATE_FILE','Asset destination collides with supplied file'); copies.set(dest,bytes); assets.set(a.id,{...a,dest});
    }
    const nodes=[], tweens=[], ids=new Set(['root','voice-track']); let end=0;
    const id = v => {slug(v); if(ids.has(v))fail('DUPLICATE_ID','Repeated scene/instance ID');ids.add(v);return v;};
    for (const s of d.scenes) {
      id(s.id); id(s.id+'-camera'); finite(s.start,0);finite(s.duration,1/job.target.fps);
      if (Math.abs(s.start-end)>1e-7 || s.start+s.duration>job.target.duration_seconds+1e-7) fail('SCENE_GAP','Scenes must continuously cover the root duration');
      end=s.start+s.duration;risks.push({time:s.start,reason:'scene-boundary'});
      const sprites=[];
      for (const i of s.instances ?? []) {
        id(i.id); const a=assets.get(i.asset); if(!a)fail('MISSING_ASSET','Unknown asset ID');
        finite(i.x,-32768,32768);finite(i.y,-32768,32768);finite(i.scale,.001,100);finite(i.start,0,s.duration);finite(i.duration,1/job.target.fps,s.duration-i.start);
        if(!Number.isInteger(i.z))fail('INVALID_LAYER','z must be an integer');
        risks.push({time:s.start+i.start,reason:'exposure-start'},{time:s.start+i.start+i.duration,reason:'exposure-end'});
        sprites.push(`<div id="${i.id}" class="clip sprite" data-start="${s.start+i.start}" data-duration="${i.duration}" data-track-index="${i.z}" style="left:${i.x-a.pivot[0]*i.scale}px;top:${i.y-a.pivot[1]*i.scale}px;width:${a.width*i.scale}px;height:${a.height*i.scale}px;z-index:${i.z}"><img src="${a.dest}" width="${a.width}" height="${a.height}" style="display:block;width:100%;height:100%" alt=""></div>`);
      }
      const c=s.camera ?? {from:{x:0,y:0,scale:1},to:{x:0,y:0,scale:1}};
      for(const pose of [c.from,c.to]) { finite(pose.x,-32768,32768);finite(pose.y,-32768,32768);finite(pose.scale,.01,10); }
      nodes.push(`<section id="${s.id}" class="clip scene" data-start="${s.start}" data-duration="${s.duration}" data-track-index="0"><div id="${s.id}-camera" class="camera">${sprites.join('\n')}</div></section>`);
      tweens.push(`tl.fromTo('#${s.id}-camera',${JSON.stringify(c.from)},${JSON.stringify({...c.to,duration:s.duration,ease:'sine.inOut',immediateRender:false})},${s.start});`);
    }
    if(Math.abs(end-job.target.duration_seconds)>1e-7)fail('SCENE_GAP','Scenes must end at the root duration');
    html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><script src="vendor/gsap.min.js"></script><style>html,body{margin:0;width:100%;height:100%}#root{position:relative;width:100%;height:100%;overflow:hidden}.scene,.camera{position:absolute;inset:0}.camera{transform-origin:50% 50%}.sprite{position:absolute}</style></head><body><div id="root" data-composition-id="${job.id}" data-width="${job.target.width}" data-height="${job.target.height}" data-fps="${job.target.fps}" data-duration="${job.target.duration_seconds}">${nodes.join('\n')}</div><script>const tl=gsap.timeline({paused:true});${tweens.join('\n')}window.__timelines['${job.id}']=tl;</script></body></html>`;
  }
  if (d.audio) {
    const bytes=await load(d.audio);
    if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')fail('INVALID_AUDIO','Build audio must be an explicitly prepared WAV');
    const audioFile=(await bound(o.workspace,base,d.audio)).file;
    const audioProbe=JSON.parse((await runCommand('ffprobe',['-v','error','-show_streams','-show_format','-of','json',audioFile])).stdout);
    if(audioProbe.streams.length!==1||audioProbe.streams[0].codec_type!=='audio'||Math.abs(Number(audioProbe.format.duration)-job.target.duration_seconds)>1/48000)fail('AUDIO_DURATION','Full audio track must match root duration at sample precision');
    copies.set('assets/voice-track.wav',bytes);
    if (d.subtitles) {
      const sub=validateSubtitles(JSON.parse((await load(d.subtitles)).toString()),job.target.duration_seconds*1000);
      if (!d.font)fail('FONT_REQUIRED','Captions require an explicitly supplied local font');
      const ext=path.extname(d.font.path);if(!['.ttf','.ttc','.otf','.woff2'].includes(ext))fail('INVALID_FONT','Unsupported font format');
      copies.set(`assets/captions${ext}`,await load(d.font));
      // Materialize the shared display window once for both HTML and subtitle exports.
      sub.segments.forEach((c,i)=>{c.display_end_ms=subtitleDisplayEnd(c,sub.segments[i+1]?.start_ms,job.target.duration_seconds*1000);risks.push({time:c.start_ms/1000,reason:'caption-start'},{time:c.display_end_ms/1000,reason:'caption-end'});});
      html=withVoiceLayers(html,sub,job.target,`captions${ext}`);
      copies.set('subtitles.json',Buffer.from(JSON.stringify(sub,null,2)+'\n'));
      copies.set('subtitles.srt',Buffer.from(subtitleText(sub,'srt')));copies.set('subtitles.vtt',Buffer.from(subtitleText(sub,'vtt')));
    } else html=withVoiceLayers(html,null,job.target,null);
  } else if (d.subtitles) fail('AUDIO_REQUIRED','Speech captions require an audio input');
  if(d.expect_audio!==undefined && typeof d.expect_audio!=='boolean')fail('INVALID_AUDIO','expect_audio must be boolean');
  job.expect_audio=d.expect_audio ?? (!!d.audio || /<audio\b/i.test(html));
  if(d.audio && !job.expect_audio)fail('INVALID_AUDIO','Attached audio cannot declare expect_audio false');
  if (hash(await readFile(o.input))!==hash(inputBytes)) fail('SOURCE_CHANGED','Build input changed');
  for(const source of sources)if(hash(await readFile(path.join(o.workspace,source.path)))!==source.sha256)fail('SOURCE_CHANGED','An input asset changed during build');
  if(/\{\{[A-Z_]+\}\}/.test(html))fail('UNRESOLVED_TEMPLATE','Packaging tokens must be explicitly filled before building');
  const out=await newDir(o.workspace,o.out);
  try {
    for(const [name,bytes] of copies){const dest=localPath(out,name);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,bytes,{flag:'wx'});}
    await writeFile(path.join(out,'index.html'),html,{flag:'wx'});
    job.assets.push(...copies.keys());await save(path.join(out,'job.json'),job);
    await prepareJob(path.join(out,'job.json'));
    // Studio normalizes HTML and mints IDs on first preview. Do that only in the new build before binding hashes.
    const ids = await runHyperframes(['timeline','ids','--dir',out,'--json'],{cwd:out,log:path.join(out,'ids.log')});
    if(JSON.parse(ids.stdout).ok!==true)fail('IDS_FAILED','Framework ID initialization did not complete');
    const prepared=await prepareJob(path.join(out,'job.json'));
    await save(path.join(out,'build.json'),{status:'completed',job:'job.json',input_sha256:hash(inputBytes),implementation:{builder_sha256:hash(await readFile(new URL(import.meta.url))),runtime_lock_sha256:hash(await readFile(path.join(FACTORY,'package-lock.json')))},sources,compiled_sources:prepared.sources,risks});
  } catch(e) {await save(path.join(out,'failed.json'),{status:'failed',code:e.code??'ERROR'});throw e;}
  return {status:'completed',out,job:path.join(out,'job.json'),visual:'pending'};
}
