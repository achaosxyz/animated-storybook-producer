import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { prepareJob, hash, fail, localPath, assertContained } from './job.mjs';
import { getTtsProvider, validateVoiceDirection, validateSpeechRequest, synthesizeSpeech } from './tts.mjs';
import { wordCaptions, validateSubtitles, subtitleText } from './subtitles.mjs';
import { pcmWave } from './audio.mjs';

const slug = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
export function validateVoiceJob(job, render) {
  getTtsProvider(job?.provider);
  const durationMs = render.target.duration_seconds * 1000;
  if (job?.schema_version !== '0.1' || job.id !== render.id || job.purpose !== render.purpose
      || !slug(job.artifact_version) || !Number.isSafeInteger(durationMs) || durationMs > 300000) fail('INVALID_VOICE_JOB', '配音 job 身份、用途、版本或时长与渲染工程不匹配');
  if (!job.speakers || Array.isArray(job.speakers) || typeof job.speakers !== 'object') fail('INVALID_VOICE_JOB', '需要 speaker 到环境变量的映射');
  for (const [speaker, key] of Object.entries(job.speakers)) {
    if (!slug(speaker) || typeof key !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(key)) fail('INVALID_VOICE_JOB', 'speaker 只能引用音色配置的环境变量名；具体能力由 provider 校验');
  }
  if (!Array.isArray(job.segments) || !job.segments.length || job.segments.length > 50) fail('INVALID_VOICE_JOB', '需要 1～50 个配音段落');
  const ids = new Set();
  let last = 0;
  for (const item of job.segments) {
    if (!slug(item.id) || ids.has(item.id) || !slug(item.scene_id) || !Object.hasOwn(job.speakers, item.speaker)
        || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 500 || /[\x00-\x1f]/.test(item.text)
        || ![item.start_ms, item.end_ms].every(Number.isSafeInteger) || item.start_ms < last
        || item.end_ms <= item.start_ms || item.end_ms > durationMs) fail('INVALID_VOICE_JOB', '台词、speaker、唯一 ID 或镜头时间槽无效/重叠');
    validateVoiceDirection(item.voice_direction);
    ids.add(item.id); last = item.end_ms;
  }
  const maxChars = job.subtitle_max_chars ?? 14;
  if (!Number.isInteger(maxChars) || maxChars < 6 || maxChars > 24) fail('INVALID_VOICE_JOB', 'subtitle_max_chars 范围为 6～24');
  return { durationMs, maxChars, speakerEnvs: job.segments.map((item) => job.speakers[item.speaker]) };
}

export async function prepareVoiceJob(file) {
  const jobPath = await realpath(file), bytes = await readFile(jobPath), job = JSON.parse(bytes);
  const base = path.dirname(jobPath);
  const renderPath = await assertContained(base, localPath(base, job.render_job));
  const render = await prepareJob(renderPath), validated = validateVoiceJob(job, render.job);
  return { ...validated, job, jobPath, voiceJobSha256: hash(bytes), render };
}

export { pcmWave, readPcmWave } from './audio.mjs';

const saveJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
export async function synthesizeVoice(prepared, config, out, { fetchImpl, fixture = false } = {}) {
  const provider = getTtsProvider(prepared.job.provider);
  const ready = provider.readiness(config, prepared.speakerEnvs);
  if (!ready.ready) fail('MISSING_CONFIG', `请配置 ${ready.missing.join('、')}；未发送合成请求`);
  if (fixture && typeof fetchImpl !== 'function') fail('INVALID_TEST_TRANSPORT', '测试夹具必须使用明确注入的响应，不得调用真实服务');
  // Validate all directions/capabilities before the first potentially paid line.
  for (const item of prepared.job.segments) validateSpeechRequest(provider, config, { ...item, speakerEnv: prepared.job.speakers[item.speaker] });
  const output = path.resolve(out), relative = path.relative(prepared.render.project, output);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) fail('OUTPUT_IN_SOURCE', '配音输出不能写入原 composition');
  // Check current source/version before the first potentially billable request.
  const initial = await prepareVoiceJob(prepared.jobPath);
  if (initial.voiceJobSha256 !== prepared.voiceJobSha256 || JSON.stringify(initial.render.sources) !== JSON.stringify(prepared.render.sources)) fail('STALE_VOICE_JOB', '配音任务或动画源已经改变');
  await mkdir(path.dirname(output), { recursive: true }); await mkdir(output, { mode: 0o700 });
  await mkdir(path.join(output, 'audio')); await mkdir(path.join(output, 'responses'));
  const manifest = { schema_version: '0.1', id: prepared.job.id, artifact_version: prepared.job.artifact_version, purpose: prepared.job.purpose,
    status: 'running', started_at: new Date().toISOString(), voice_job_sha256: prepared.voiceJobSha256,
    render_sources: prepared.render.sources, duration_ms: prepared.durationMs,
    provider: fixture ? 'synthetic-test-fixture' : provider.implementation, live_provider_call: !fixture,
    utterances: [], output: {}, canonical_version: null, gate_c: null, audio_review: 'pending' };
  const save = () => saveJson(path.join(output, 'manifest.json'), manifest);
  await save();
  try {
    const track = Buffer.alloc(prepared.durationMs * config.sampleRate / 1000 * 2), captions = [], allWords = [];
    for (const item of prepared.job.segments) {
      if (item.text.includes(config.apiKey)) fail('SECRET_IN_TEXT', '台词包含鉴权值，拒绝发送');
      const entry = { id: item.id, speaker: item.speaker, scene_id: item.scene_id, start_ms: item.start_ms, end_ms: item.end_ms,
        request_id: randomUUID(), status: 'requesting' };
      manifest.utterances.push(entry); await save();
      const actual = await synthesizeSpeech(provider, config, { ...item, speakerEnv: prepared.job.speakers[item.speaker] }, path.join(output, 'audio', item.id), {
        requestId: entry.request_id, fetchImpl, metadataFile: path.join(output, 'responses', `${item.id}.json`),
        onAudioReceived: async (r) => { entry.status = 'audio_received'; entry.log_id = r.logId; entry.source_sha256 = r.sourceSha256; await save(); },
      });
      entry.duration_ms = actual.durationMs; entry.path = `audio/${item.id}.wav`; entry.sha256 = actual.sha256; await save();
      const words = actual.words;
      // Keep valid timing/request evidence even when the editorial slot is short.
      if (actual.durationMs > item.end_ms - item.start_ms) fail('VOICE_SLOT_OVERFLOW', `台词 ${item.id} 实测时长超出镜头时间槽；调整时序或稿件，不截音频`);
      const startByte = item.start_ms * config.sampleRate / 1000 * 2;
      actual.pcm.copy(track, startByte);
      captions.push(...wordCaptions(words, item, prepared.maxChars));
      allWords.push({ utterance_id: item.id, speaker: item.speaker, start_ms: item.start_ms, words });
      entry.status = 'ready'; await save();
    }
    const subtitles = validateSubtitles({ schema_version: '0.1', time_unit: 'ms', episode_id: prepared.job.id, segments: captions }, prepared.durationMs);
    await saveJson(path.join(output, 'subtitles.json'), subtitles);
    await saveJson(path.join(output, 'word-timings.json'), { time_unit: 'ms', utterances: allWords });
    await writeFile(path.join(output, 'subtitles.srt'), subtitleText(subtitles, 'srt'));
    await writeFile(path.join(output, 'subtitles.vtt'), subtitleText(subtitles, 'vtt'));
    await writeFile(path.join(output, 'audio/track.wav'), pcmWave(track, config.sampleRate));
    for (const name of ['audio/track.wav', 'subtitles.json', 'subtitles.srt', 'subtitles.vtt', 'word-timings.json']) {
      manifest.output[name] = { sha256: hash(await readFile(path.join(output, name))) };
    }
    const after = await prepareVoiceJob(prepared.jobPath);
    if (after.voiceJobSha256 !== prepared.voiceJobSha256 || JSON.stringify(after.render.sources) !== JSON.stringify(prepared.render.sources)) fail('STALE_VOICE_JOB', '合成过程中台词或动画源发生变更，结果需重新审核');
    manifest.status = 'completed'; manifest.finished_at = new Date().toISOString(); await save();
    return { out: output, manifest };
  } catch (error) {
    manifest.status = 'failed'; manifest.error = { code: error.code ?? 'VOICE_FAILED', message: error.code ? error.message : '本地声音处理失败；查看保留的运行证据' };
    await save(); throw error;
  }
}
