import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSpeechArgs } from './speech-args.mjs';
import { DEFAULT_VOICE_ENV } from '../src/voice-config.mjs';
import { listTtsProviders, prepareTtsJob, validateSpeechRequest, runTtsJob } from '../src/tts.mjs';

const EXAMPLE = fileURLToPath(new URL('../examples/backend-smoke/tts-job.json', import.meta.url));
export function parseTtsArgs(args) {
  return parseSpeechArgs(args, { providers: { allowed: [] }, check: { allowed: ['job', 'env'] },
    synthesize: { allowed: ['job', 'env', 'out', 'allow-paid'], required: ['out'] } },
    { job: { type: 'string' }, env: { type: 'string' }, out: { type: 'string' }, 'allow-paid': { type: 'boolean' } },
    { job: EXAMPLE, env: DEFAULT_VOICE_ENV });
}

export async function main(args = process.argv.slice(2)) {
  const { action, values } = parseTtsArgs(args);
  if (action === 'providers') { console.log(JSON.stringify({ providers: listTtsProviders(), network_requests: 0 })); return; }
  const prepared = await prepareTtsJob(path.resolve(values.job));
  const config = await prepared.provider.loadConfig(path.resolve(values.env));
  const ready = prepared.provider.readiness(config, [prepared.input.speakerEnv]);
  if (ready.ready) validateSpeechRequest(prepared.provider, config, prepared.input);
  if (action === 'check') {
    console.log(JSON.stringify({ status: ready.ready ? 'configured-not-live-verified' : 'blocked-missing-config', provider: prepared.provider.id,
      id: prepared.job.id, missing: ready.missing, direction_requested: prepared.input.voice_direction !== undefined,
      network_requests: 0, audio_generated: false }));
    if (!ready.ready) process.exitCode = 2;
    return;
  }
  const result = await runTtsJob(prepared, config, path.resolve(values.out), { allowPaid: values['allow-paid'] === true });
  console.log(JSON.stringify({ status: result.manifest.status, provider: prepared.provider.id, out: result.out,
    duration_ms: result.manifest.duration_ms, audio_review: 'pending' }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(JSON.stringify({ code: error.code ?? 'TTS_FAILED',
    message: error.code ? error.message : 'TTS 本地处理失败，不输出原始配置、参数或回包' })); process.exitCode = 1; });
}
