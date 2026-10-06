import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSpeechArgs } from './speech-args.mjs';
import { DEFAULT_VOICE_ENV } from '../src/voice-config.mjs';
import { getTtsProvider, validateSpeechRequest } from '../src/tts.mjs';
import { prepareVoiceJob, synthesizeVoice } from '../src/voice-worker.mjs';
import { attachVoice } from '../src/voice-attach.mjs';

const EXAMPLE = fileURLToPath(new URL('../examples/backend-smoke/voice-job.json', import.meta.url));
export function parseVoiceArgs(args) {
  return parseSpeechArgs(args, { check: { allowed: ['job', 'env'] },
    synthesize: { allowed: ['job', 'env', 'out'], required: ['out'] },
    attach: { allowed: ['job', 'run', 'out', 'font'], required: ['job', 'run', 'out'] } },
    { job: { type: 'string' }, env: { type: 'string' }, out: { type: 'string' }, run: { type: 'string' }, font: { type: 'string' } },
    { job: EXAMPLE, env: DEFAULT_VOICE_ENV });
}

export async function main(args = process.argv.slice(2)) {
  const { action, values } = parseVoiceArgs(args);
  if (action === 'attach') {
    const result = await attachVoice(path.resolve(values.job), path.resolve(values.run), path.resolve(values.out), values.font);
    console.log(JSON.stringify({ status: 'prepared', ...result, render_qa: 'pending', voice_listening_review: 'pending' }));
    return;
  }
  const prepared = await prepareVoiceJob(path.resolve(values.job));
  const provider = getTtsProvider(prepared.job.provider);
  const config = await provider.loadConfig(path.resolve(values.env));
  const ready = provider.readiness(config, prepared.speakerEnvs);
  if (ready.ready) for (const item of prepared.job.segments) validateSpeechRequest(provider, config, { ...item, speakerEnv: prepared.job.speakers[item.speaker] });
  if (action === 'check') {
    console.log(JSON.stringify({ status: ready.ready ? 'configured-not-live-verified' : 'blocked-missing-config',
      missing: ready.missing, env_file: path.resolve(values.env), id: prepared.job.id,
      duration_ms: prepared.durationMs, utterances: prepared.job.segments.length,
      network_requests: 0, audio_generated: false, timestamps_generated: false }));
    if (!ready.ready) process.exitCode = 2;
    return;
  }
  const result = await synthesizeVoice(prepared, config, path.resolve(values.out));
  console.log(JSON.stringify({ status: result.manifest.status, out: result.out, id: result.manifest.id,
    artifact_version: result.manifest.artifact_version, utterances: result.manifest.utterances.length,
    duration_ms: result.manifest.duration_ms, voice_listening_review: 'pending', canonical_version: null, gate_c: null }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(JSON.stringify({ code: error.code ?? 'VOICE_FAILED',
    message: error.code ? error.message : '本地配音处理失败；不输出原始请求、返回正文或环境值' })); process.exitCode = 1; });
}
