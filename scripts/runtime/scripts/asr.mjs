import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSpeechArgs } from './speech-args.mjs';
import { DEFAULT_ASR_ENV } from '../src/volcengine-asr.mjs';
import { listAsrProviders, getAsrProvider, prepareAsrAudio, runAsr } from '../src/asr.mjs';

export function parseAsrArgs(args) {
  return parseSpeechArgs(args, { providers: { allowed: [] }, check: { allowed: ['provider', 'env', 'audio'] },
    recognize: { allowed: ['provider', 'env', 'audio', 'out'], required: ['audio', 'out'] } },
  { provider: { type: 'string' }, env: { type: 'string' }, audio: { type: 'string' }, out: { type: 'string' } },
  { provider: 'volcengine', env: DEFAULT_ASR_ENV });
}
export async function main(args = process.argv.slice(2)) {
  const { action, values } = parseAsrArgs(args);
  if (action === 'providers') { console.log(JSON.stringify({ providers: listAsrProviders(), network_requests: 0 })); return; }
  const provider = getAsrProvider(values.provider), config = await provider.loadConfig(path.resolve(values.env)), ready = provider.readiness(config);
  if (action === 'check') {
    const audio = values.audio ? await prepareAsrAudio(path.resolve(values.audio)) : null;
    console.log(JSON.stringify({ status: ready.ready ? 'configured-not-live-verified' : 'blocked-missing-config', missing: ready.missing,
      provider: provider.id, duration_ms: audio?.durationMs ?? null, network_requests: 0, transcript_generated: false }));
    if (!ready.ready) process.exitCode = 2; return;
  }
  const result = await runAsr(provider, config, await prepareAsrAudio(path.resolve(values.audio)), path.resolve(values.out));
  console.log(JSON.stringify({ status: result.manifest.status, provider: provider.id, out: result.out, transcript_review: 'pending' }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(e => { console.error(JSON.stringify({ code: e.code ?? 'ASR_FAILED', message: e.code ? e.message : 'ASR 本地处理失败，不输出原始参数、配置或回包' })); process.exitCode = 1; });
}
