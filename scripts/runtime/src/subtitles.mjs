import { fail } from './job.mjs';

const spokenText = (text) => text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');

export function normalizeWords(sentences, durationMs, requestedText) {
  const words = [], seen = new Set();
  for (const sentence of sentences) {
    if (!sentence || !Array.isArray(sentence.words)) fail('TIMESTAMPS_MISSING', 'TTS 缺少字级时间戳，不能按文本估算字幕');
    for (const item of sentence.words) {
      if (typeof item.word !== 'string' || !item.word.trim() || /[\r\n\x00]/.test(item.word)
          || !Number.isFinite(item.startTime) || !Number.isFinite(item.endTime)
          || item.startTime < 0 || item.endTime < item.startTime) fail('INVALID_TIMESTAMP', 'TTS 字级时间戳或文本无效');
      const start = Math.round(item.startTime * 1000), end = Math.round(item.endTime * 1000);
      if (end > durationMs) fail('TIMESTAMP_OVERFLOW', 'TTS 字级时间戳超出实测音频时长');
      const identity = JSON.stringify([start, end, item.word]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const previous = words.at(-1);
      if (previous && start < previous.end_ms) fail('TIMESTAMP_ORDER', 'TTS 时间戳倒退或重叠，不能猜测分句偏移');
      if (start === end) {
        if (!previous || spokenText(item.word)) fail('INVALID_TIMESTAMP', '有声字的时间区间必须大于零');
        previous.text += item.word;
      } else words.push({ text: item.word, start_ms: start, end_ms: end,
        confidence: Number.isFinite(item.confidence) ? item.confidence : null });
    }
  }
  if (!words.length) fail('TIMESTAMPS_MISSING', 'TTS 没有可用的字级时间戳，保留音频但不伪造字幕');
  if (spokenText(words.map((w) => w.text).join('')) !== spokenText(requestedText)) {
    fail('TRANSCRIPT_MISMATCH', 'TTS 时间戳文本与台词不一致；请核对文本规范化，不能错配字幕');
  }
  return words;
}

export function wordCaptions(words, utterance, maxChars = 14) {
  const captions = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    captions.push({ scene_id: utterance.scene_id, speaker: utterance.speaker,
      text: current.map((w) => w.text).join(''),
      start_ms: utterance.start_ms + current[0].start_ms,
      end_ms: utterance.start_ms + current.at(-1).end_ms,
      audio_path: `audio/${utterance.id}.wav` });
    current = [];
  };
  for (const word of words) {
    const chars = [...current.map((w) => w.text).join('') + word.text].length;
    if (current.length && (chars > maxChars || word.start_ms - current.at(-1).end_ms > 500)) flush();
    current.push(word);
    if (/[。！？!?；;]$/.test(word.text) || [...current.map((w) => w.text).join('')].length >= maxChars) flush();
  }
  flush();
  return captions;
}

export function validateSubtitles(document, durationMs) {
  if (document?.schema_version !== '0.1' || document.time_unit !== 'ms' || !Array.isArray(document.segments)) fail('INVALID_SUBTITLES', '字幕契约无效');
  let last = 0;
  const bilingual = document.segments.some((cue) => cue?.text_en !== undefined);
  for (const cue of document.segments) {
    if (![cue.scene_id, cue.speaker].every((s) => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(s))
        || typeof cue.audio_path !== 'string' || !/^audio\/[a-z0-9][a-z0-9-]{0,79}\.wav$/.test(cue.audio_path)
        || ![cue.start_ms, cue.end_ms].every(Number.isSafeInteger) || cue.start_ms < last || cue.end_ms <= cue.start_ms
        || cue.end_ms > durationMs || typeof cue.text !== 'string' || !cue.text.trim() || /[\r\n\x00]/.test(cue.text)) {
      fail('INVALID_SUBTITLES', '字幕必须为毫秒、正时长、按序不重叠且位于作品时长内');
    }
    if (bilingual && (typeof cue.text_en !== 'string' || !cue.text_en.trim() || cue.text_en.length > 500 || /[\x00-\x1f\x7f]/.test(cue.text_en))) {
      fail('INVALID_SUBTITLES', '双语字幕每段均须提供完整英文译文，不含控制字符；不从英文长度猜时间戳');
    }
    last = cue.end_ms;
  }
  for (let i = 0; i < document.segments.length; i += 1) {
    const cue = document.segments[i];
    if (cue.display_end_ms !== undefined && (!Number.isSafeInteger(cue.display_end_ms)
        || cue.display_end_ms < cue.end_ms || cue.display_end_ms > durationMs
        || cue.display_end_ms > (document.segments[i + 1]?.start_ms ?? durationMs))) {
      fail('INVALID_SUBTITLES', '字幕阅读结束必须保留真实语音区间、不重叠下一条且不超出作品时长');
    }
  }
  return document;
}

// Editorial reading time is separate from provider speech timestamps.
export function subtitleDisplayEnd(cue, nextStartMs, durationMs) {
  const desired = cue.display_end_ms ?? (cue.text_en === undefined ? cue.end_ms
    : Math.max(cue.end_ms, cue.start_ms + Math.max(1800, Math.ceil([...cue.text_en].length / 17 * 1000))));
  return Math.min(desired, nextStartMs ?? durationMs, durationMs);
}

function time(ms, separator) {
  const hour = Math.floor(ms / 3600000), minute = Math.floor(ms / 60000) % 60, second = Math.floor(ms / 1000) % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`;
}
export function subtitleText(document, format) {
  const vtt = format === 'vtt';
  if (!vtt && format !== 'srt') fail('INVALID_SUBTITLES', '仅支持 srt / vtt');
  return (vtt ? 'WEBVTT\n\n' : '') + document.segments.map((cue, i) => `${i + 1}\n${time(cue.start_ms, vtt ? '.' : ',')} --> ${time(cue.display_end_ms ?? cue.end_ms, vtt ? '.' : ',')}\n${cue.text}${cue.text_en === undefined ? '' : `\n${cue.text_en}`}\n`).join('\n');
}
