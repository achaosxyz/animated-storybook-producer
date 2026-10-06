import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE, fail } from './job.mjs';

export const DEFAULT_VOICE_ENV = path.join(WORKSPACE, '.env/volcengine-tts.env');

// Deliberately does not source shell code or expand variables, and never echoes values.
export function parseVoiceEnv(text) {
  const result = Object.create(null);
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(result, match[1])) fail('INVALID_ENV', `环境文件第 ${index + 1} 行无效或重复`);
    let value = match[2];
    if (/^["']/.test(value)) {
      const quoted = value.match(/^(["'])(.*?)\1\s*(?:#.*)?$/);
      if (!quoted) fail('INVALID_ENV', `环境文件第 ${index + 1} 行引号不完整`);
      value = quoted[2];
    } else value = value.replace(/\s+#.*$/, '').trim();
    result[match[1]] = value;
  }
  return result;
}

export async function loadVoiceConfig(envFile = DEFAULT_VOICE_ENV, inherited = process.env) {
  let local = {};
  try { local = parseVoiceEnv(await readFile(envFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const env = { ...local, ...inherited };
  const numeric = (key, fallback, min, max) => {
    const raw = env[key] ?? String(fallback);
    if (!/^-?\d+$/.test(raw)) fail('INVALID_CONFIG', `${key} 必须为整数`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_CONFIG', `${key} 超出范围`);
    return value;
  };
  const config = {
    resourceId: env.VOLCENGINE_TTS_RESOURCE_ID ?? 'seed-tts-2.0',
    model: env.VOLCENGINE_TTS_MODEL ?? '',
    speechRate: numeric('VOLCENGINE_TTS_SPEECH_RATE', 0, -50, 100),
    sampleRate: numeric('VOLCENGINE_TTS_SAMPLE_RATE', 24000, 24000, 24000),
    timeoutMs: numeric('VOLCENGINE_TTS_TIMEOUT_MS', 120000, 1000, 300000),
    voices: Object.fromEntries(Object.entries(env).filter(([key]) => /^VOLCENGINE_TTS_SPEAKER_[A-Z0-9_]+$/.test(key))),
  };
  if (!['seed-tts-2.0', 'seed-icl-2.0'].includes(config.resourceId)) fail('INVALID_CONFIG', '资源 ID 必须选择已接入的 seed-tts-2.0 或 seed-icl-2.0');
  if (config.model && !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(config.model)) fail('INVALID_CONFIG', 'VOLCENGINE_TTS_MODEL 格式无效');
  // Prevent accidental serialization of credentials into a run manifest or CLI JSON.
  Object.defineProperty(config, 'apiKey', { value: env.VOLCENGINE_TTS_API_KEY ?? '', enumerable: false });
  if (config.apiKey && config.model === config.apiKey) fail('INVALID_CONFIG', '不得把 API Key 当模型标识');
  return config;
}

export function voiceReadiness(config, speakerEnvs) {
  const missing = [];
  if (!config.apiKey || /^(your[_-]?api[_-]?key|changeme|replace.*)$/i.test(config.apiKey)) missing.push('VOLCENGINE_TTS_API_KEY');
  else if (!/^[!-~]+$/.test(config.apiKey)) fail('INVALID_CONFIG', 'VOLCENGINE_TTS_API_KEY 含无效字符');
  for (const key of new Set(speakerEnvs)) {
    if (!/^VOLCENGINE_TTS_SPEAKER_[A-Z0-9_]+$/.test(key)) fail('INVALID_CONFIG', '音色必须引用 TTS speaker 环境变量');
    const voice = config.voices[key];
    if (!voice) missing.push(key);
    else if (!/^[A-Za-z0-9_.-]{1,128}$/.test(voice) || voice === config.apiKey) fail('INVALID_CONFIG', `${key} 音色 ID 格式无效；不得把 API Key 当音色`);
  }
  return { ready: missing.length === 0, missing };
}
