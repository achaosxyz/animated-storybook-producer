import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import WebSocket from 'ws';
import { WORKSPACE, fail } from './job.mjs';
import { parseVoiceEnv } from './voice-config.mjs';

export const DEFAULT_ASR_ENV = path.join(WORKSPACE, '.env/volcengine-asr.env');
export const ASR_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
const STREAM_RESOURCES = ['volc.seedasr.sauc.duration', 'volc.seedasr.sauc.concurrent', 'volc.bigasr.sauc.duration', 'volc.bigasr.sauc.concurrent'];
const PACKET_MS = 200, MAX_RESPONSE = 16 * 1024 * 1024;
export async function loadAsrConfig(file = DEFAULT_ASR_ENV, inherited = process.env) {
  let local = {};
  try { local = parseVoiceEnv(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const env = { ...local, ...inherited };
  const rawTimeout = env.VOLCENGINE_ASR_TIMEOUT_MS ?? '180000';
  if (!/^\d+$/.test(rawTimeout) || Number(rawTimeout) < 1000 || Number(rawTimeout) > 300000) fail('INVALID_CONFIG', 'VOLCENGINE_ASR_TIMEOUT_MS 必须为 1000～300000 毫秒');
  const config = { resourceId: env.VOLCENGINE_ASR_RESOURCE_ID ?? 'volc.seedasr.sauc.duration', timeoutMs: Number(rawTimeout) };
  if (!STREAM_RESOURCES.includes(config.resourceId)) fail('INVALID_CONFIG', '当前 ASR adapter 仅接受流式 sauc 资源；录音文件 auc 资源不能用于此接口');
  Object.defineProperty(config, 'apiKey', { value: env.VOLCENGINE_ASR_API_KEY ?? '', enumerable: false });
  return config;
}
export function asrReadiness(config) {
  const missing = !config.apiKey || /^(changeme|your[_-]?api[_-]?key|replace.*)$/i.test(config.apiKey) ? ['VOLCENGINE_ASR_API_KEY'] : [];
  if (!missing.length && !/^[!-~]+$/.test(config.apiKey)) fail('INVALID_CONFIG', 'VOLCENGINE_ASR_API_KEY 含无效字符');
  return { ready: missing.length === 0, missing };
}

function clientPacket(type, sequence, bytes, last = false) {
  const body = gzipSync(bytes), header = Buffer.from([0x11, (type << 4) | (last ? 3 : 1), 0x11, 0]);
  const fields = Buffer.alloc(8); fields.writeInt32BE(last ? -sequence : sequence); fields.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, fields, body]);
}

function serverPacket(bytes) {
  const bad = () => fail('ASR_PROTOCOL', 'ASR 二进制响应不完整或协议不支持；不输出原始回包');
  if (bytes.length < 8 || bytes.length > MAX_RESPONSE || bytes[0] >> 4 !== 1) bad();
  const headerSize = (bytes[0] & 15) * 4, type = bytes[1] >> 4, flags = bytes[1] & 15;
  const serialization = bytes[2] >> 4, compression = bytes[2] & 15;
  if (headerSize < 4 || headerSize > bytes.length || ![9, 15].includes(type) || flags > 7 || ![0, 1].includes(compression)) bad();
  let offset = headerSize;
  const read = () => { if (offset + 4 > bytes.length) bad(); const n = bytes.readUInt32BE(offset); offset += 4; return n; };
  if (flags & 1) read();
  if (flags & 4) read();
  const code = type === 15 ? read() : 0, size = read();
  if (size !== bytes.length - offset) bad();
  if (type === 15) fail('ASR_PROVIDER', `ASR 状态码 ${code}；不输出供应商错误正文或重试`);
  if (serialization !== 1) bad();
  let payload;
  try {
    const body = compression ? gunzipSync(bytes.subarray(offset), { maxOutputLength: MAX_RESPONSE }) : bytes.subarray(offset);
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch { bad(); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) bad();
  if (Object.hasOwn(payload, 'code') && ![0, 20000000].includes(payload.code)) fail('ASR_PROVIDER', 'ASR 返回失败状态；不输出供应商错误正文或重试');
  return { payload, last: Boolean(flags & 2) };
}

export async function recognizeVolcengine(config, audio, { requestId, webSocketFactory = (url, options) => new WebSocket(url, options) } = {}) {
  const ready = asrReadiness(config);
  if (!ready.ready) fail('MISSING_CONFIG', `请配置 ${ready.missing.join('、')}；未发送识别请求`);
  if (!STREAM_RESOURCES.includes(config.resourceId)) fail('INVALID_CONFIG', 'ASR 需要流式 sauc 资源');
  if (!audio.streamBytes?.length || audio.streamBytes.length % 2 || audio.streamFormat !== 'pcm' || audio.sampleRate !== 16000) fail('INVALID_ASR_AUDIO', 'ASR 需要已预检的单声道 16kHz 16-bit PCM');
  const request = { model_name: 'bigmodel', enable_itn: false, enable_punc: true, enable_ddc: false,
    show_utterances: true, result_type: 'full', enable_nonstream: true };
  const metadata = { user: { uid: requestId }, audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 }, request };
  let socket, idleTimer, sendTimer, totalTimer, stop;
  try {
    const payload = await new Promise((resolve, reject) => {
      let done = false, acknowledged = false, sentLast = false, offset = 0, sequence = 2, nextDeadline = 0;
      const finish = (error, value) => { if (done) return; done = true; clearTimeout(idleTimer); clearTimeout(sendTimer); clearTimeout(totalTimer); error ? reject(error) : resolve(value); };
      const error = (code, message) => { try { fail(code, message); } catch (e) { finish(e); } };
      const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => error('ASR_TIMEOUT', 'ASR 流式请求超时，可能已计费；保留 request_id，不自动重发'), config.timeoutMs); };
      stop = () => error('ASR_CANCELLED', 'ASR 流式请求已中断，可能已计费；保留 request_id，不自动重发');
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      touch();
      totalTimer = setTimeout(() => error('ASR_TIMEOUT', 'ASR 流式请求超过音频时长与等待预算；不自动重发'), audio.streamBytes.length / 32 + config.timeoutMs * 2);
      socket = webSocketFactory(ASR_ENDPOINT, { headers: { 'X-Api-Key': config.apiKey,
        'X-Api-Resource-Id': config.resourceId, 'X-Api-Request-Id': requestId },
        followRedirects: false, handshakeTimeout: config.timeoutMs, maxPayload: MAX_RESPONSE, perMessageDeflate: false });
      const send = (packet, callback) => {
        if (done) return;
        try { socket.send(packet, { binary: true }, (e) => { if (done) return; if (e) error('ASR_NETWORK', 'ASR 发送失败，可能已计费；不输出原始异常或重试'); else { touch(); callback?.(); } }); }
        catch { error('ASR_NETWORK', 'ASR 发送失败，可能已计费；不输出原始异常或重试'); }
      };
      const sendAudio = () => {
        if (done) return;
        const end = Math.min(offset + 6400, audio.streamBytes.length), last = end === audio.streamBytes.length;
        const packet = clientPacket(2, sequence++, audio.streamBytes.subarray(offset, end), last);
        offset = end; sentLast = last;
        send(packet, () => {
          if (last) return;
          nextDeadline = Math.max(nextDeadline + PACKET_MS, performance.now());
          sendTimer = setTimeout(sendAudio, Math.max(0, nextDeadline - performance.now()));
        });
      };
      socket.once('open', () => send(clientPacket(1, 1, Buffer.from(JSON.stringify(metadata)))));
      socket.on('message', (data, isBinary) => {
        if (done) return;
        try {
          if (!isBinary) fail('ASR_PROTOCOL', 'ASR 返回非二进制消息；不输出原始回包');
          const response = serverPacket(Buffer.from(data)); touch();
          if (response.last) {
            if (!sentLast) fail('ASR_PROTOCOL', '音频发送结束前收到最终结果，不接受截断转写');
            if (!response.payload.result || response.payload.result.utterances?.some(u => u.definite === false)) fail('ASR_PROTOCOL', 'ASR 最终响应缺少结果或仍含未确定分句');
            finish(null, response.payload);
          } else if (!acknowledged) { acknowledged = true; nextDeadline = performance.now(); sendAudio(); }
        } catch (e) { finish(e); }
      });
      socket.once('unexpected-response', (_req, response) => {
        response.destroy(); error('ASR_HTTP', `ASR WebSocket 握手 HTTP ${Number.isInteger(response.statusCode) ? response.statusCode : 'unknown'}；不跟随跳转或重试`);
      });
      socket.on('error', () => error('ASR_NETWORK', 'ASR 连接失败，可能已计费；不输出原始异常或重试'));
      socket.once('close', () => error('ASR_NETWORK', 'ASR 在最终结果前断开；不将中间结果写为完整转写，不自动重发'));
    });
    const log = payload.result?.additions?.log_id;
    return { payload, requestId, logId: typeof log === 'string' ? (log.includes(config.apiKey) ? '[REDACTED]' : log) : null,
      request: { endpoint: ASR_ENDPOINT, resource_id: config.resourceId, source_format: audio.format,
        audio_format: 'pcm', sample_rate: 16000, bits: 16, channel: 1, packet_duration_ms: PACKET_MS, ...request } };
  } catch (e) {
    if (e.code?.startsWith('ASR_')) throw e;
    fail('ASR_NETWORK', 'ASR 请求未完整完成，可能已计费；保留 request_id，不输出原始异常或自动重发');
  } finally {
    clearTimeout(idleTimer); clearTimeout(sendTimer); clearTimeout(totalTimer);
    if (stop) { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
    socket?.terminate();
  }
}

export function normalizeAsr(response, durationMs) {
  const spoken = (text) => text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
  const result = response.payload?.result;
  if (!result || typeof result.text !== 'string' || /[\x00]/.test(result.text)) fail('ASR_PROTOCOL', 'ASR 缺少识别文本');
  const segments = [];
  if (result.text.trim() && (!Array.isArray(result.utterances) || !result.utterances.length)) fail('TIMESTAMPS_MISSING', 'ASR 有文本但没有真实分句时间戳，不估算字幕');
  let last = 0;
  for (const item of result.utterances ?? []) {
    if (typeof item.text !== 'string' || !item.text.trim() || /[\x00\r\n]/.test(item.text)
      || ![item.start_time, item.end_time].every(Number.isSafeInteger) || item.start_time < last
      || item.end_time <= item.start_time || item.end_time > durationMs) fail('INVALID_TIMESTAMP', 'ASR 分句时间戳倒退、重叠或超出实际音频');
    const words = []; let wordEnd = item.start_time;
    for (const w of item.words ?? []) {
      if (typeof w.text !== 'string' || !w.text.trim() || /[\x00\r\n]/.test(w.text) || ![w.start_time, w.end_time].every(Number.isSafeInteger)
        || w.start_time < wordEnd || w.end_time <= w.start_time || w.end_time > item.end_time) fail('INVALID_TIMESTAMP', 'ASR 字时间戳无效');
      words.push({ text: w.text, start_ms: w.start_time, end_ms: w.end_time, confidence: Number.isFinite(w.confidence) ? w.confidence : null }); wordEnd = w.end_time;
    }
    if (words.length && spoken(words.map(w => w.text).join('')) !== spoken(item.text)) fail('TRANSCRIPT_MISMATCH', 'ASR 字时间戳文本与分句文本不一致，不猜测修补');
    segments.push({ text: item.text, start_ms: item.start_time, end_ms: item.end_time, speaker: null, words }); last = item.end_time;
  }
  if (spoken(segments.map(s => s.text).join('')) !== spoken(result.text)) fail('TRANSCRIPT_MISMATCH', 'ASR 分句文本与完整转写不一致，不自动替换');
  return { schema_version: '0.1', source: 'asr', time_unit: 'ms', text: result.text, duration_ms: durationMs, segments,
    request_id: response.requestId, log_id: response.logId, transcript_review: 'pending' };
}

export const volcengineAsrProvider = Object.freeze({ id: 'volcengine', implementation: 'volcengine-asr-streaming',
  loadConfig: loadAsrConfig, readiness: asrReadiness, recognize: recognizeVolcengine, normalize: normalizeAsr });
