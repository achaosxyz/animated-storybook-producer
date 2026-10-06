import { randomUUID } from 'node:crypto';
import { fail } from './job.mjs';
import { voiceReadiness } from './voice-config.mjs';

export const TTS_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';

// HTTP chunk boundaries are not JSON boundaries. Accept NDJSON, pretty JSON and
// adjacent JSON objects; reject truncated payloads and never retry a paid request.
export async function* jsonObjects(body) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', start = -1, depth = 0, quoted = false, escape = false, total = 0;
  const consume = function* (text) {
    for (const char of text) {
      if (start < 0) {
        if (/\s/.test(char)) continue;
        if (char !== '{') fail('TTS_PROTOCOL', 'TTS 返回的不是 JSON 对象流');
        buffer = ''; start = 0;
      }
      buffer += char;
      if (buffer.length > 16 * 1024 * 1024) fail('TTS_PROTOCOL', 'TTS 单个响应对象过大');
      if (quoted) {
        if (escape) escape = false;
        else if (char === '\\') escape = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{' || char === '[') depth += 1;
      else if (char === '}' || char === ']') {
        depth -= 1;
        if (depth === 0) {
          let value;
          try { value = JSON.parse(buffer); } catch { fail('TTS_PROTOCOL', 'TTS JSON 无效'); }
          start = -1; buffer = ''; yield value;
        }
      }
    }
  };
  try {
    for await (const chunk of body) {
      total += chunk.byteLength;
      if (total > 128 * 1024 * 1024) fail('TTS_PROTOCOL', 'TTS 响应总量过大');
      yield* consume(decoder.decode(chunk, { stream: true }));
    }
    yield* consume(decoder.decode());
  } catch (error) {
    if (error.code) throw error;
    fail('TTS_PROTOCOL', 'TTS 响应流中断或编码无效；不自动重发');
  }
  if (start >= 0 || depth !== 0) fail('TTS_PROTOCOL', 'TTS 响应不完整；不自动重发');
}

export function validateVoiceDirection(value) {
  if (value === undefined) return;
  if (typeof value !== 'string' || !value.trim() || value.length > 400 || /[\x00-\x1f]/.test(value)) fail('INVALID_VOICE_DIRECTION', 'voice_direction 必须为 1～400 字的非空语气指令，不含控制字符');
  return value.trim();
}

export function voiceAdditions(config, utterance) {
  const direction = validateVoiceDirection(utterance.voice_direction);
  if (direction === undefined) return;
  if (direction.includes(config.apiKey)) fail('SECRET_IN_TEXT', '语气指令包含鉴权值，拒绝发送');
  const voice = config.voices[utterance.speakerEnv];
  const builtin = /^zh_[a-z]+_[a-z0-9]+_uranus_bigtts$/.test(voice)
    || /^ICL_uranus_zh_(female|male)_[a-z0-9_]+_tob$/.test(voice);
  // Public ICL_uranus voices are 2.0 catalogue voices, not a user's cloned S_ voice.
  if (config.resourceId !== 'seed-tts-2.0' || config.model || !builtin) fail('UNSUPPORTED_VOICE_DIRECTION', '语气指令当前仅接入已核对的中文 uranus 2.0 内置音色，不能混用复刻资源或指定 model');
  // The HTTP API expects additions to be a JSON string, not an object or text.
  return JSON.stringify({ context_texts: [direction] });
}

export async function synthesizeUtterance(config, utterance, { requestId = randomUUID(), fetchImpl = fetch } = {}) {
  const readiness = voiceReadiness(config, [utterance.speakerEnv]);
  if (!readiness.ready) fail('MISSING_CONFIG', `请配置 ${readiness.missing.join('、')}；未发送合成请求`);
  if (typeof utterance.text !== 'string' || !utterance.text.trim() || utterance.text.includes(config.apiKey)) fail('INVALID_VOICE_TEXT', '台词无效或包含鉴权值');
  const reqParams = {
    text: utterance.text,
    speaker: config.voices[utterance.speakerEnv],
    audio_params: { format: 'mp3', sample_rate: config.sampleRate, speech_rate: config.speechRate, enable_subtitle: true },
  };
  const additions = voiceAdditions(config, utterance);
  if (additions !== undefined) reqParams.additions = additions;
  if (config.model) reqParams.model = config.model;
  const headers = { 'Content-Type': 'application/json', 'X-Api-Key': config.apiKey,
    'X-Api-Resource-Id': config.resourceId, 'X-Api-Request-Id': requestId };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), config.timeoutMs);
  let response;
  try {
    // Fixed official origin and no redirects: credentials never follow an arbitrary URL.
    response = await fetchImpl(TTS_ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ req_params: reqParams }),
      signal: abort.signal, redirect: 'error' });
    if (!response.ok) fail('TTS_HTTP', `TTS HTTP ${response.status}；不自动重试`);
    if (!response.body) fail('TTS_PROTOCOL', 'TTS 无响应流');
    const chunks = [], sentences = [], responseCodes = new Set();
    let usage = null, bytes = 0, events = 0;
    for await (const event of jsonObjects(response.body)) {
      if (++events > 20000) fail('TTS_PROTOCOL', 'TTS 响应事件过多');
      // HTTP documentation shows 0; the live API also emits the V3 CodeOK.
      // Accept only these exact numeric success codes, never all 2xxxxxxx values.
      if (event.code !== 0 && event.code !== 20000000) fail('TTS_PROVIDER', `TTS 返回错误码 ${Number.isInteger(event.code) ? event.code : 'unknown'}；不记录原始错误正文或重试`);
      responseCodes.add(event.code);
      if (event.data) {
        if (typeof event.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.data)) fail('TTS_PROTOCOL', 'TTS 音频 base64 无效');
        const data = Buffer.from(event.data, 'base64');
        bytes += data.length;
        if (bytes > 32 * 1024 * 1024) fail('TTS_PROTOCOL', 'TTS 音频过大');
        chunks.push(data);
      }
      if (event.sentence) sentences.push(event.sentence);
      if (event.usage) usage = event.usage;
    }
    if (!bytes) fail('TTS_AUDIO_MISSING', 'TTS 未返回真实音频');
    const rawLogId = response.headers.get('X-Tt-Logid');
    const logId = rawLogId?.includes(config.apiKey) ? '[REDACTED]' : rawLogId;
    return { audio: Buffer.concat(chunks), sentences, requestId, logId, usage, responseCodes: [...responseCodes],
      request: { endpoint: TTS_ENDPOINT, resource_id: config.resourceId, req_params: reqParams } };
  } catch (error) {
    if (error.code?.startsWith('TTS_')) throw error;
    fail(abort.signal.aborted ? 'TTS_TIMEOUT' : 'TTS_NETWORK', 'TTS 请求未完整完成，可能已计费；保留 request_id，核对后再操作，不自动重发');
  } finally {
    clearTimeout(timer);
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}
