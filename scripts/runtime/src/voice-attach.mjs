import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { prepareJob, validateJob, hash, fail, localPath, assertContained } from './job.mjs';
import { validateSubtitles, subtitleDisplayEnd } from './subtitles.mjs';
import { readPcmWave } from './voice-worker.mjs';
import { runCommand } from './runtime.mjs';

const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function chineseCaption(text, prefix) {
  const chunks = text.split(/(?<=[，。！？；、])/u).filter(Boolean);
  if ([...text].length <= 17 || chunks.length < 2 || chunks.some(chunk => [...chunk].length > 17)) return escapeHtml(text);
  return chunks.map((chunk, i) => `${i ? `<wbr data-hf-id="${prefix}-break-${i}">` : ''}<span data-hf-id="${prefix}-chunk-${i}" class="voice-caption-phrase">${escapeHtml(chunk)}</span>`).join('');
}

// Captions are timed clips; audio and clip visibility stay framework-owned.
export function withVoiceLayers(html, subtitles, target, fontName) {
  if (/<audio\b/i.test(html) || /id=["']voice-track["']/i.test(html)) fail('ALREADY_HAS_AUDIO', '原工程已有音轨，不重复挂接');
  const rootTag = html.match(/<[^>]+\bdata-composition-id\s*=\s*["'][^"']+["'][^>]*>/i)?.[0];
  if (!rootTag || !/<\/head>/i.test(html)) fail('INVALID_COMPOSITION', '缺少可挂接的独立 composition');
  const prefix = 'voice-layer';
  if (html.includes(prefix)) fail('ALREADY_HAS_AUDIO', '原工程已有配音/字幕挂接');
  const audio = `<audio id="voice-track" data-hf-id="${prefix}-audio" src="assets/voice-track.wav" data-start="0" data-duration="${target.duration_seconds}" data-track-index="1" data-volume="1"></audio>`;
  if (!subtitles) return html.replace(rootTag, `${rootTag}\n${audio}`);
  if (target.width < 720 || target.height < 1280) fail('CAPTION_LAYOUT_UNSUPPORTED', 'Current captions require portrait dimensions');
  const fontSize = Math.round(target.width * 0.0482), englishSize = Math.round(target.width * 0.0352), bottom = Math.round(target.height * 0.0365);
  const chineseSlot = (fontSize * 2.7).toFixed(1), englishSlot = (englishSize * 2.7).toFixed(1);
  const bilingualHeight = (fontSize * 2.7 + englishSize * 2.7 + 8).toFixed(1);
  const style = `<style id="${prefix}-style">@font-face{font-family:'VoiceCaptions';src:url('assets/${fontName}');font-weight:400;font-style:normal;font-display:block}
  .voice-caption-clip{position:absolute;inset:0;z-index:10000;pointer-events:none}
  .voice-caption{position:absolute;left:7%;right:7%;bottom:${bottom}px;box-sizing:border-box;padding:0;background:transparent;color:#263c32;font-family:'VoiceCaptions';font-weight:400;font-style:normal;text-align:center;overflow-wrap:break-word;display:flex;flex-direction:column;align-items:center;gap:8px;text-shadow:0 1px 3px rgba(255,255,250,.65)}
  .voice-caption-zh{font-size:${fontSize}px;line-height:1.35;letter-spacing:.4px;max-width:100%;text-wrap:balance}
  .voice-caption-phrase{white-space:nowrap}
  .voice-caption-en{font-size:${englishSize}px;line-height:1.35;letter-spacing:0;max-width:100%;text-wrap:balance;color:#31483b;font-style:normal}
  .voice-caption-bilingual{height:${bilingualHeight}px;display:grid;grid-template-rows:${chineseSlot}px ${englishSlot}px;align-items:normal;justify-items:center}
  .voice-caption-bilingual .voice-caption-zh{align-self:end}
  .voice-caption-bilingual .voice-caption-en{align-self:start}</style>`;
  const clips = subtitles.segments.map((cue, i) => {
    // A bilingual reading hold is editorial display time, not a fabricated speech timestamp.
    const end = subtitleDisplayEnd(cue, subtitles.segments[i + 1]?.start_ms, target.duration_seconds * 1000);
    return `<section id="${prefix}-${i}" data-hf-id="${prefix}-${i}" class="clip voice-caption-clip" data-start="${cue.start_ms / 1000}" data-duration="${(end - cue.start_ms) / 1000}" data-speech-end-ms="${cue.end_ms}" data-track-index="2"><div data-hf-id="${prefix}-text-${i}" class="voice-caption${cue.text_en === undefined ? '' : ' voice-caption-bilingual'}"><div data-hf-id="${prefix}-zh-${i}" class="voice-caption-zh" lang="zh-CN">${chineseCaption(cue.text, `${prefix}-zh-${i}`)}</div>${cue.text_en === undefined ? '' : `<div data-hf-id="${prefix}-en-${i}" class="voice-caption-en" lang="en">${escapeHtml(cue.text_en)}</div>`}</div></section>`;
  }).join('\n');
  return html.replace(/<\/head>/i, `${style}\n</head>`).replace(rootTag, `${rootTag}\n${audio}\n${clips}`);
}

export async function attachVoice(jobFile, runDir, outDir, fontFile) {
  const prepared = await prepareJob(jobFile), run = await realpath(runDir);
  const manifest = JSON.parse(await readFile(path.join(run, 'manifest.json'), 'utf8'));
  if (manifest.status !== 'completed' || manifest.id !== prepared.job.id || manifest.duration_ms !== prepared.job.target.duration_seconds * 1000
      || JSON.stringify(manifest.render_sources) !== JSON.stringify(prepared.sources)) fail('STALE_VOICE_RUN', '声音运行未完成、源动画已改变或时长/身份不匹配');
  if (prepared.job.expect_audio) fail('ALREADY_HAS_AUDIO', '原 job 已含声音，请从无声版本建立新挂接版本');
  for (const [name, value] of Object.entries(manifest.output ?? {})) {
    const file = await assertContained(run, localPath(run, name));
    if (hash(await readFile(file)) !== value.sha256) fail('VOICE_OUTPUT_CHANGED', '声音或字幕与生成记录不一致');
  }
  for (const name of ['audio/track.wav', 'subtitles.json']) if (!manifest.output?.[name]) fail('INVALID_VOICE_RUN', '缺少音轨或真实时间戳字幕');
  const track = await readFile(path.join(run, 'audio/track.wav'));
  if (readPcmWave(track).durationMs !== manifest.duration_ms) fail('INVALID_VOICE_RUN', '拼合音轨的实际时长不匹配');
  const subtitles = validateSubtitles(JSON.parse(await readFile(path.join(run, 'subtitles.json'), 'utf8')), manifest.duration_ms);
  if (!subtitles.segments.length || subtitles.episode_id !== prepared.job.id) fail('INVALID_VOICE_RUN', '字幕为空或绑定错误作品');
  for (const cue of subtitles.segments) {
    const item = manifest.utterances?.find((u) => u.path === cue.audio_path && u.status === 'ready');
    if (!item || cue.speaker !== item.speaker || cue.scene_id !== item.scene_id || cue.start_ms < item.start_ms || cue.end_ms > item.start_ms + item.duration_ms) fail('INVALID_VOICE_RUN', '字幕与实测台词音轨/角色不匹配');
    const file = await assertContained(run, localPath(run, cue.audio_path));
    if (hash(await readFile(file)) !== item.sha256) fail('VOICE_OUTPUT_CHANGED', '台词音频与生成记录不一致');
  }
  if (!fontFile) fontFile = (await runCommand('fc-match', [':lang=zh-cn', '-f', '%{file}'])).stdout.trim();
  const font = await readFile(fontFile);
  if (font.length > 32 * 1024 * 1024 || !['ttcf', 'OTTO', 'wOFF', 'wOF2', '\x00\x01\x00\x00'].includes(font.toString('latin1', 0, 4))) fail('INVALID_FONT', '需要本地真实字体，不能把其他私有文件当字体复制');
  const extension = path.extname(fontFile).toLowerCase();
  if (!['.ttc', '.ttf', '.otf', '.woff', '.woff2'].includes(extension)) fail('INVALID_FONT', '字体扩展名不支持');
  const fontName = `voice-font${extension}`;
  const originalHtml = await readFile(path.join(prepared.project, 'index.html'));
  if (hash(originalHtml) !== prepared.sources.find((s) => s.path === 'index.html')?.sha256) fail('SOURCE_CHANGED', '源 HTML 已改变');
  const html = withVoiceLayers(originalHtml.toString('utf8'), subtitles, prepared.job.target, fontName);
  const output = path.resolve(outDir);
  const containers = [prepared.project, run];
  for (const parent of containers) {
    const rel = path.relative(parent, output);
    if (!rel || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))) fail('OUTPUT_IN_SOURCE', '新工程不得写进原动画或声音运行目录');
  }
  const job = validateJob({ ...prepared.job, artifact_version: `${manifest.artifact_version}-av`, project: '.', expect_audio: true,
    assets: [...prepared.job.assets, 'assets/voice-track.wav', `assets/${fontName}`] });
  await mkdir(path.dirname(output), { recursive: true }); await mkdir(output);
  for (const name of prepared.job.assets) {
    const bytes = await readFile(localPath(prepared.project, name));
    if (hash(bytes) !== prepared.sources.find((s) => s.path === name)?.sha256) fail('SOURCE_CHANGED', '源资产在复制前改变');
    const file = localPath(output, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes, { flag: 'wx' });
  }
  await mkdir(path.join(output, 'assets'), { recursive: true });
  await writeFile(path.join(output, 'assets/voice-track.wav'), track, { flag: 'wx' });
  await writeFile(path.join(output, `assets/${fontName}`), font, { flag: 'wx' });
  await writeFile(path.join(output, 'index.html'), html, { flag: 'wx' });
  await writeFile(path.join(output, 'job.json'), JSON.stringify(job, null, 2) + '\n', { flag: 'wx' });
  const current = await prepareJob(jobFile);
  if (JSON.stringify(current.sources) !== JSON.stringify(prepared.sources)) fail('SOURCE_CHANGED', '挂接期间源动画改变，不能追认此版本');
  const result = await prepareJob(path.join(output, 'job.json'));
  await writeFile(path.join(output, 'voice-attachment.json'), JSON.stringify({ schema_version: '0.1', status: 'prepared',
    artifact_version: job.artifact_version, source_animation: prepared.sources, attached_sources: result.sources,
    voice_manifest_sha256: hash(await readFile(path.join(run, 'manifest.json'))), provider: manifest.provider,
    live_provider_call: manifest.live_provider_call, font_source: fontFile, font_sha256: hash(font),
    render_qa: 'pending', voice_listening_review: 'pending', canonical_version: null, gate_c: null }, null, 2) + '\n');
  return { job: path.join(output, 'job.json'), artifact_version: job.artifact_version };
}
