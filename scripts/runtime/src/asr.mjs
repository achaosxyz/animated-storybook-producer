import { readFile, writeFile, realpath, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fail, hash } from './job.mjs';
import { runCommand } from './runtime.mjs';
import { subtitleText } from './subtitles.mjs';
import { volcengineAsrProvider } from './volcengine-asr.mjs';

const providers = Object.freeze({ volcengine: volcengineAsrProvider });
export const listAsrProviders = () => Object.values(providers).map(({ id, implementation }) => ({ id, implementation }));
export function getAsrProvider(id = 'volcengine') {
  if (!Object.hasOwn(providers, id)) fail('UNSUPPORTED_ASR_PROVIDER', '该 ASR provider 未实现；没有自动降级或外部 adapter 加载');
  return providers[id];
}
async function streamPcm(bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-map', '0:a:0',
      '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = []; let size = 0, expired = false, oversized = false;
    const timer = setTimeout(() => { expired = true; child.kill('SIGKILL'); }, 180000);
    const interrupt = () => { expired = true; child.kill('SIGKILL'); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const cleanup = () => { clearTimeout(timer); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); };
    const bad = () => { try { fail('INVALID_ASR_AUDIO', '音频无法转换为流式识别所需的单声道 16kHz PCM；不输出原始解码错误'); } catch (e) { reject(e); } };
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 16000 * 2 * 7200) { oversized = true; child.kill('SIGKILL'); } else chunks.push(chunk);
    });
    child.stdin.on('error', () => {});
    child.once('error', () => { cleanup(); bad(); });
    child.once('close', code => {
      cleanup();
      if (code !== 0 || expired || oversized || !size || size % 2) bad(); else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(bytes);
  });
}
export async function prepareAsrAudio(file) {
  const audioPath = await realpath(file), info = await stat(audioPath), format = path.extname(audioPath).slice(1).toLowerCase();
  if (!['wav', 'mp3', 'ogg'].includes(format) || !info.isFile() || !info.size || info.size > 100 * 1024 * 1024) fail('INVALID_ASR_AUDIO', 'ASR 只接受不超过 100MiB 的本地 WAV/MP3/OGG 文件');
  let metadata;
  try { metadata = JSON.parse((await runCommand('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', audioPath])).stdout); }
  catch { fail('INVALID_ASR_AUDIO', '音频未通过本地解码元数据检查；不输出原始文件内容或 FFprobe 错误'); }
  const streams = metadata.streams?.filter(s => s.codec_type === 'audio') ?? [], duration = Number(metadata.format?.duration);
  if (streams.length !== 1 || metadata.streams.length !== 1 || !metadata.format.format_name.split(',').includes(format) || (format === 'ogg' && streams[0].codec_name !== 'opus')
    || !Number.isFinite(duration) || duration <= 0 || duration > 7200) fail('INVALID_ASR_AUDIO', 'ASR 输入格式不符、不是单一音轨或时长不在 0～2 小时内');
  const bytes = await readFile(audioPath), streamBytes = await streamPcm(bytes);
  return { audioPath, format, bytes, sha256: hash(bytes), sourceDurationMs: Math.floor(duration * 1000),
    durationMs: Math.floor(streamBytes.length / 32), streamBytes, streamSha256: hash(streamBytes), streamFormat: 'pcm', sampleRate: 16000 };
}
export async function runAsr(provider, config, audio, out, { webSocketFactory, fixture = false } = {}) {
  const ready = provider.readiness(config);
  if (!ready.ready) fail('MISSING_CONFIG', `请配置 ${ready.missing.join('、')}；未发送识别请求`);
  if (config.apiKey && audio.bytes.includes(Buffer.from(config.apiKey))) fail('SECRET_IN_AUDIO', '音频文件包含鉴权值，拒绝上传');
  if (fixture && typeof webSocketFactory !== 'function') fail('INVALID_TEST_TRANSPORT', 'ASR 测试必须注入 WebSocket transport，不调用真实服务');
  if (hash(await readFile(audio.audioPath)) !== audio.sha256 || hash(audio.bytes) !== audio.sha256
    || !audio.streamBytes?.length || hash(audio.streamBytes) !== audio.streamSha256) fail('STALE_ASR_AUDIO', 'ASR 源音频或规范化 PCM 已改变，未发送请求');
  const output = path.resolve(out), relative = path.relative(output, audio.audioPath);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) fail('OUTPUT_IN_SOURCE', 'ASR 输出不能包含原音频');
  await mkdir(path.dirname(output), { recursive: true }); await mkdir(output, { mode: 0o700 });
  const manifest = { schema_version: '0.1', purpose: 'exploration', status: 'requesting',
    provider: fixture ? 'synthetic-test-fixture' : provider.implementation, live_provider_call: !fixture,
    started_at: new Date().toISOString(), request_id: randomUUID(), input: { sha256: audio.sha256, format: audio.format,
      source_duration_ms: audio.sourceDurationMs, duration_ms: audio.durationMs, stream_sha256: audio.streamSha256, stream_format: 'pcm', sample_rate: 16000 },
    output: {}, transcript_review: 'pending', character_speaker_mapping: null };
  const save = () => writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  await save();
  try {
    const response = await provider.recognize(config, audio, { requestId: manifest.request_id, webSocketFactory });
    const transcript = provider.normalize(response, audio.durationMs);
    // ASR does not know the episode's characters or replace its TTS cues.
    // normalize() owns ASR bounds; do not invent episode/audio-path bindings to
    // satisfy the separate story subtitle contract. The formatter needs only cues.
    const subtitles = { segments: transcript.segments };
    const files = { 'transcript.json': JSON.stringify(transcript, null, 2) + '\n', 'transcript.txt': transcript.text + '\n',
      'subtitles.srt': subtitleText(subtitles, 'srt'), 'subtitles.vtt': subtitleText(subtitles, 'vtt'),
      'request.json': JSON.stringify(response.request, null, 2) + '\n' };
    if (Object.values(files).some(text => text.includes(config.apiKey))) fail('ASR_PROTOCOL', 'ASR 返回含鉴权值，拒绝写出');
    for (const [name, text] of Object.entries(files)) { await writeFile(path.join(output, name), text, { flag: 'wx', mode: 0o600 }); manifest.output[name] = { sha256: hash(Buffer.from(text)) }; }
    if (hash(await readFile(audio.audioPath)) !== audio.sha256) fail('STALE_ASR_AUDIO', '识别期间输入音频改变，结果需重新审核');
    manifest.status = 'completed'; manifest.finished_at = new Date().toISOString(); await save();
    return { out: output, manifest };
  } catch (e) {
    manifest.status = 'failed'; manifest.error = { code: e.code ?? 'ASR_FAILED', message: e.code ? e.message : 'ASR 本地处理失败，不输出原始凭证或回包' }; await save(); throw e;
  }
}
