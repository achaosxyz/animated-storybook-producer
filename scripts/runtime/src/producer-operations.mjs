import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from './producer-build.mjs';
import { json, save, bound, newDir, runVideo, escapeHtml, hash, fail, input } from './producer-io.mjs';
import { runCommand } from './runtime.mjs';
import { verifyMedia } from './job.mjs';
export async function probe(file) { return JSON.parse((await runCommand('ffprobe',['-v','error','-count_frames','-show_data_hash','sha256','-show_streams','-show_format','-of','json',file])).stdout); }
async function inspect(o) {
  const state=o.state ? await json(o.state) : null;
  const missing=[];
  if (!state) missing.push('project state / IP input');
  if (state) {
    for(const entry of state.bindings??[]) await bound(o.workspace,path.dirname(o.state),entry);
    if ((state.issues??[]).some(i=>!Number.isInteger(i.repair_rounds)||i.repair_rounds<0||i.repair_rounds>5)) fail('INVALID_STATE','Repair counts must be integers from zero to five');
  }
  return {status:missing.length?'needs-input':'inspected',missing,state,next:state?.next??'Propose or import the user IP; inspect actual Codex imagegen and Doubao configuration',approval:'not-inferred',network_requests:0};
}
async function packageMedia(o) {
  const inputBytes=await readFile(o.input),d=JSON.parse(inputBytes), base=path.dirname(o.input);
  if(d.schema_version!=='1'||!Array.isArray(d.parts)||!d.parts.length)fail('INVALID_PACKAGE','Expected ordered parts with hashes');
  const mode=d.mode??'copy';
  if(!['copy','normalize'].includes(mode))fail('INVALID_PACKAGE','Package mode must be copy or normalize');
  const parts=[];
  for(const e of d.parts){const b=await bound(o.workspace,base,e);parts.push({...b,probe:await probe(b.file)});}
  const streams=p=>p.probe.streams.map(s=>({codec_type:s.codec_type,codec_name:s.codec_name,width:s.width,height:s.height,pix_fmt:s.pix_fmt,r_frame_rate:s.r_frame_rate,time_base:s.time_base,sample_rate:s.sample_rate,channels:s.channels,channel_layout:s.channel_layout,profile:s.profile,codec_tag_string:s.codec_tag_string,extradata_hash:s.extradata_hash,level:s.level,sample_aspect_ratio:s.sample_aspect_ratio,color_range:s.color_range,color_space:s.color_space,color_transfer:s.color_transfer,color_primaries:s.color_primaries}));
  const spec=JSON.stringify(streams(parts[0]));
  if(mode==='copy' && parts.some(p=>JSON.stringify(streams(p))!==spec))fail('INCOMPATIBLE_MEDIA','Package requires compatible streams; explicitly prepare matching audio/video, no silent transcode');
  const v=parts[0].probe.streams.find(s=>s.codec_type==='video');if(!v)fail('INVALID_MEDIA','Video stream missing');
  const [num,den]=v.r_frame_rate.split('/').map(Number), fps=num/den;
  const frames=parts.reduce((n,p)=>n+Number(p.probe.streams.find(s=>s.codec_type==='video').nb_read_frames),0);
  const target={width:v.width,height:v.height,fps,duration_seconds:frames/fps};
  if(![24,30,60].includes(fps)||!Number.isInteger(frames)||frames<=0)fail('INVALID_MEDIA','Expected supported fps and decoded video frame counts');
  const durations=parts.map(p=>{
    const videos=p.probe.streams.filter(s=>s.codec_type==='video'),audios=p.probe.streams.filter(s=>s.codec_type==='audio');
    if(videos.length!==1||audios.length>1||p.probe.streams.length!==videos.length+audios.length)fail('INVALID_MEDIA','Each part needs exactly one video and at most one audio stream');
    const stream=videos[0],duration=Number(stream.nb_read_frames)/fps;
    if(stream.width!==v.width||stream.height!==v.height||stream.r_frame_rate!==v.r_frame_rate||!Number.isFinite(duration)||duration<=0)fail('INCOMPATIBLE_MEDIA','Normalize preserves framing: width, height and fps must already match');
    if(mode==='normalize' && audios.length && Number(audios[0].duration)>duration+1/fps)fail('AUDIO_OVERFLOW','Part audio extends beyond picture; revise the edit instead of truncating speech');
    return duration;
  });
  const expectAudio=mode==='normalize'||parts[0].probe.streams.some(s=>s.codec_type==='audio');
  for(const p of parts) if(/[\r\n']/.test(p.file))fail('INVALID_PATH','Concat path contains unsupported delimiters');
  const out=await newDir(o.workspace,o.out);
  try {
    await writeFile(path.join(out,'concat.txt'),parts.map(p=>`file '${p.file}'`).join('\n')+'\n',{flag:'wx'});
    if(mode==='copy') {
      await runCommand('ffmpeg',['-v','error','-f','concat','-safe','0','-i',path.join(out,'concat.txt'),'-c','copy','-movflags','+faststart',path.join(out,'output.mp4')],{log:path.join(out,'concat.log')});
    } else {
      // Explicit picture-locked normalization: no crop/scale, no inherited silent defaults, one continuous encode.
      const filters=parts.flatMap((p,i)=>{
        const duration=durations[i],hasAudio=p.probe.streams.some(s=>s.codec_type==='audio');
        return [`[${i}:v:0]setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v${i}]`,hasAudio
          ?`[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${i}]`
          :`anullsrc=r=48000:cl=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${i}]`];
      });
      filters.push(parts.map((_,i)=>`[v${i}][a${i}]`).join('')+`concat=n=${parts.length}:v=1:a=1[v][a]`);
      await runCommand('ffmpeg',['-v','error',...parts.flatMap(p=>['-i',p.file]),'-filter_complex',filters.join(';'),'-map','[v]','-map','[a]','-c:v','libx264','-crf','18','-preset','medium','-r',String(fps),'-c:a','aac','-b:a','192k','-movflags','+faststart',path.join(out,'output.mp4')],{log:path.join(out,'concat.log')});
    }
    const metadata=await probe(path.join(out,'output.mp4'));
    verifyMedia(metadata,target,expectAudio);
    for(const p of parts)if(hash(await readFile(p.file))!==p.sha256)fail('SOURCE_CHANGED','Media changed during packaging');
    if(hash(await readFile(o.input))!==hash(inputBytes))fail('SOURCE_CHANGED','Package edit changed during processing');
    await save(path.join(out,'manifest.json'),{status:'completed',command:'package',mode,target,expect_audio:expectAudio,parts:parts.map(p=>({path:path.relative(out,p.file),sha256:p.sha256})),part_durations_seconds:durations,input_sha256:hash(inputBytes),output:{path:'output.mp4',sha256:hash(await readFile(path.join(out,'output.mp4')))},checks:{technical:'passed',visual:'pending',listening:'not_performed'},gate_c:null});
  } catch(e){await save(path.join(out,'failed.json'),{status:'failed',code:e.code??'ERROR'});throw e;}
  return {status:'completed',out};
}
async function deliver(o) {
  const media=await runVideo(o.workspace,o.run), review=await json(o.review);
  if(review.video_sha256!==media.sha256)fail('STALE_REVIEW','Review must bind the final video hash');
  const playback=await bound(o.workspace,path.dirname(o.review),review.playback);
  const evidence=JSON.parse(playback.bytes);
  if(evidence.video_sha256!==media.sha256||evidence.status!=='passed'||evidence.playback?.ended!==true)fail('MISSING_PLAYBACK','A completed, hash-bound playback report is required');
  const reviewStates=new Set(['passed','pending','failed','not_performed','not_applicable']);
  if(!reviewStates.has(review.visual)||!reviewStates.has(review.listening)||!Array.isArray(review.known_limits)||review.known_limits.some(v=>typeof v!=='string'||!v.trim()))fail('INVALID_REVIEW','Use explicit visual/listening states and a list of nonempty text limits');
  const decoded=await probe(media.file);
  verifyMedia(decoded,media.manifest.target,media.manifest.expect_audio ?? (media.manifest.output.media?.audio_streams > 0));
  const out=await newDir(o.workspace,o.out);
  await writeFile(path.join(out,'output.mp4'),media.bytes,{flag:'wx'});
  await writeFile(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>Storybook review copy</title><h1>Review copy</h1><p>User approval: pending</p><dl><dt>Visual review</dt><dd>${escapeHtml(review.visual)}</dd><dt>Listening review</dt><dd>${escapeHtml(review.listening)}</dd></dl><p>These are declared review states, not automated aesthetic or listening verification.</p><video controls playsinline preload="metadata" src="output.mp4" style="max-width:100%;max-height:85vh"></video><h2>Known limits</h2><p>${review.known_limits.length?escapeHtml(review.known_limits.join('; ')):'No additional limits declared; see review states above.'}</p>`,{flag:'wx'});
  await mkdir(path.join(out,'qa'));
  await writeFile(path.join(out,'qa/playback.json'),playback.bytes,{flag:'wx'});
  review.playback={path:'qa/playback.json',sha256:playback.sha256};
  await save(path.join(out,'delivery.json'),{status:'review-copy',video_sha256:media.sha256,source_run:media.run,review,gate_c:null});
  return {status:'review-copy',out,viewer:path.join(out,'index.html')};
}
export async function execute(action,o) {
  if(action==='inspect')return inspect(o);
  if(action==='build')return build(o);
  if(action==='package')return packageMedia(o);
  if(action==='deliver')return deliver(o);
  if(action.startsWith('qa '))return (await import('./producer-qa.mjs')).qa(action.slice(3),o);
  if(['music render','audio assemble'].includes(action)) {
    const script=fileURLToPath(new URL('../../python/audio.py',import.meta.url));
    const result=await runCommand('python3',[script,action==='music render'?'music':'assemble','--workspace',o.workspace,'--input',o.input,'--out',o.out]);
    return JSON.parse(result.stdout);
  }
  fail('INVALID_ACTION','Unknown operation');
}
