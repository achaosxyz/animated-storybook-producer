import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fail, hash } from './job.mjs';
import { loadVoiceConfig, voiceReadiness } from './voice-config.mjs';
import { synthesizeUtterance, validateVoiceDirection, voiceAdditions } from './volcengine-tts.mjs';
import { normalizeWords } from './subtitles.mjs';
import { readPcmWave } from './audio.mjs';
import { runCommand } from './runtime.mjs';

export { validateVoiceDirection } from './volcengine-tts.mjs';

// Provider-specific config, capabilities, wire protocol and timing normalization
// live here/inside the adapter, never in the story worker or CLI.
const providers = Object.freeze({
  volcengine: Object.freeze({ id: 'volcengine', implementation: 'volcengine-http-v3', audioFormat: 'mp3',
    loadConfig: loadVoiceConfig, readiness: voiceReadiness, validate: voiceAdditions,
    synthesize: synthesizeUtterance,
    normalizeTimings: (response, durationMs, text) => normalizeWords(response.sentences, durationMs, text),
  }),
});
export function getTtsProvider(id = 'volcengine') {
  if (!Object.hasOwn(providers, id)) fail('UNSUPPORTED_TTS_PROVIDER', '该 TTS provider 未实现；没有自动降级或动态加载外部 adapter');
  return providers[id];
}
export const listTtsProviders = () => Object.values(providers).map(({ id, implementation }) => ({ id, implementation }));

export function validateSpeechRequest(provider, config, input) {
  if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 500 || /[\x00-\x1f]/.test(input.text)) fail('INVALID_VOICE_TEXT', '台词必须为 1～500 字且不含控制字符');
  validateVoiceDirection(input.voice_direction);
  const ready = provider.readiness(config, [input.speakerEnv]);
  if (!ready.ready) fail('MISSING_CONFIG', `请配置 ${ready.missing.join('、')}；未发送合成请求`);
  if (config.apiKey && (input.text.includes(config.apiKey) || input.voice_direction?.includes(config.apiKey))) fail('SECRET_IN_TEXT', '台词或语气指令包含鉴权值，拒绝发送');
  provider.validate(config, input);
}

// Shared lifecycle: one paid call, source retention, real PCM duration and
// provider-owned normalization to millisecond word timings. No scene dependency.
export async function synthesizeSpeech(provider, config, input, fileBase, { requestId = randomUUID(), fetchImpl, onAudioReceived, metadataFile = `${fileBase}-response.json` } = {}) {
  validateSpeechRequest(provider, config, input);
  if (!['mp3', 'wav'].includes(provider.audioFormat)) fail('UNSUPPORTED_AUDIO_FORMAT', 'provider 的源音频格式未接入');
  const response = await provider.synthesize(config, input, { requestId, fetchImpl });
  const original = `${fileBase}.${provider.audioFormat === 'wav' ? 'source.wav' : 'mp3'}`, normalized = `${fileBase}.wav`;
  await writeFile(original, response.audio, { flag: 'wx', mode: 0o600 });
  await onAudioReceived?.({ logId: response.logId, sourceSha256: hash(response.audio), original });
  await runCommand('ffmpeg', ['-v', 'error', '-i', original, '-map_metadata', '-1', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', normalized], { log: `${fileBase}-decode.log` });
  const bytes = await readFile(normalized), actual = readPcmWave(bytes, 24000);
  const words = provider.normalizeTimings(response, Math.floor(actual.durationMs), input.text);
  const metadata = { request_id: response.requestId ?? requestId, log_id: response.logId,
    request: response.request, response_codes: response.responseCodes, words,
    usage: Number.isFinite(response.usage?.text_words) ? { text_words: response.usage.text_words } : null };
  await writeFile(metadataFile, JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { ...actual, words, bytes, original, normalized, metadata,
    sha256: hash(bytes), sourceSha256: hash(response.audio) };
}

export async function prepareTtsJob(file) {
  const jobPath = await realpath(file), bytes = await readFile(jobPath), job = JSON.parse(bytes);
  const slug = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(v);
  if (job?.schema_version !== '0.1' || !slug(job.id) || !slug(job.artifact_version) || !['technical_validation', 'exploration'].includes(job.purpose)
    || typeof job.speaker_env !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(job.speaker_env)) fail('INVALID_TTS_JOB', 'TTS job 的身份、用途或声线配置引用无效');
  if (typeof job.text !== 'string' || !job.text.trim() || job.text.length > 500 || /[\x00-\x1f]/.test(job.text)) fail('INVALID_TTS_JOB', 'TTS job 需要 1～500 字非空台词');
  validateVoiceDirection(job.voice_direction);
  const provider = getTtsProvider(job.provider);
  return { jobPath, job, jobSha256: hash(bytes), provider,
    input: { text: job.text, speakerEnv: job.speaker_env, voice_direction: job.voice_direction } };
}

export async function runTtsJob(prepared, config, out, { fetchImpl, fixture = false } = {}) {
  validateSpeechRequest(prepared.provider, config, prepared.input);
  if (fixture && typeof fetchImpl !== 'function') fail('INVALID_TEST_TRANSPORT', '测试夹具必须注入 transport，不得调用真实服务');
  if (hash(await readFile(prepared.jobPath)) !== prepared.jobSha256) fail('STALE_TTS_JOB', 'TTS 输入已改变，未发送请求');
  const output = path.resolve(out);
  // Do not consume/overwrite the input job when the requested output encloses it.
  const relative = path.relative(output, prepared.jobPath);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) fail('OUTPUT_IN_SOURCE', 'TTS 输出不能包含输入 job');
  await mkdir(path.dirname(output), { recursive: true }); await mkdir(output, { mode: 0o700 });
  const manifest = { schema_version: '0.1', id: prepared.job.id, artifact_version: prepared.job.artifact_version, purpose: prepared.job.purpose,
    provider: fixture ? 'synthetic-test-fixture' : prepared.provider.implementation, live_provider_call: !fixture,
    status: 'requesting', started_at: new Date().toISOString(), job_sha256: prepared.jobSha256,
    request_id: randomUUID(), output: {}, audio_review: 'pending' };
  const save = () => writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  await save();
  try {
    const result = await synthesizeSpeech(prepared.provider, config, prepared.input, path.join(output, 'speech'), {
      requestId: manifest.request_id, fetchImpl,
      onAudioReceived: async (r) => { manifest.status = 'audio_received'; manifest.source_sha256 = r.sourceSha256; await save(); },
    });
    manifest.duration_ms = result.durationMs; manifest.sample_rate = 24000;
    for (const file of [result.original, result.normalized, path.join(output, 'speech-response.json')]) manifest.output[path.basename(file)] = { sha256: hash(await readFile(file)) };
    if (hash(await readFile(prepared.jobPath)) !== prepared.jobSha256) fail('STALE_TTS_JOB', '合成过程中 TTS 输入改变，保留音频供重新审核');
    manifest.status = 'completed'; manifest.finished_at = new Date().toISOString(); await save();
    return { out: output, manifest };
  } catch (error) {
    manifest.status = 'failed'; manifest.error = { code: error.code ?? 'TTS_FAILED', message: error.code ? error.message : 'TTS 本地处理失败，不输出原始鉴权或回包' };
    await save(); throw error;
  }
}
