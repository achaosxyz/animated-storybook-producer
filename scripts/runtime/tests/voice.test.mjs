import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, access, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseVoiceEnv, loadVoiceConfig, voiceReadiness } from '../src/voice-config.mjs';
import { TTS_ENDPOINT, jsonObjects, synthesizeUtterance } from '../src/volcengine-tts.mjs';
import { normalizeWords, wordCaptions, validateSubtitles, subtitleText, subtitleDisplayEnd } from '../src/subtitles.mjs';
import { validateVoiceJob, prepareVoiceJob, synthesizeVoice, pcmWave, readPcmWave } from '../src/voice-worker.mjs';
import { withVoiceLayers, attachVoice } from '../src/voice-attach.mjs';
import { prepareJob } from '../src/job.mjs';
import { runCommand } from '../src/runtime.mjs';
import { parseVoiceArgs } from '../scripts/voice.mjs';
import { parseTtsArgs } from '../scripts/tts.mjs';
import { getTtsProvider, listTtsProviders, validateSpeechRequest, synthesizeSpeech, prepareTtsJob, runTtsJob } from '../src/tts.mjs';

let fixtureRoot, mp3;
before(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'voice-fixtures-'));
  const file = path.join(fixtureRoot, 'tone-not-speech.mp3');
  await runCommand('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=0.7', '-c:a', 'libmp3lame', file]);
  mp3 = await readFile(file);
});
after(async () => { await rm(fixtureRoot, { recursive: true, force: true }); });
const words = () => [{ word: '看', startTime: 0.05, endTime: 0.3 }, { word: '一', startTime: 0.3, endTime: 0.5 }, { word: '看。', startTime: 0.5, endTime: 0.65 }];
const baseJob = () => ({ schema_version: '0.1', id: 'voice-test', artifact_version: 'silent-v1', purpose: 'technical_validation', project: '.',
  target: { width: 1080, height: 1920, fps: 30, duration_seconds: 4 }, assets: ['vendor/gsap.min.js'], expect_audio: false });
const voiceJob = () => ({ schema_version: '0.1', id: 'voice-test', artifact_version: 'voice-v1', purpose: 'technical_validation', render_job: 'job.json',
  speakers: { narrator: 'VOLCENGINE_TTS_SPEAKER_NARRATOR' }, segments: [{ id: 'line-1', scene_id: 'test-scene', speaker: 'narrator', text: '看一看。', start_ms: 500, end_ms: 1500 }] });
const html = () => '<!doctype html><html><head><script src="vendor/gsap.min.js"></script></head><body><div id="root" data-composition-id="voice-test" data-width="1080" data-height="1920" data-duration="4"></div></body></html>';
async function config() {
  return loadVoiceConfig(path.join(fixtureRoot, 'absent.env'), { VOLCENGINE_TTS_API_KEY: 'fixture-only-not-a-real-key', VOLCENGINE_TTS_SPEAKER_NARRATOR: 'fixture-voice' });
}
async function project(t, job = voiceJob()) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voice-worker-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); await mkdir(source);
  await writeFile(path.join(source, 'job.json'), JSON.stringify(baseJob()));
  await writeFile(path.join(source, 'index.html'), html());
  const file = path.join(source, 'voice-job.json'); await writeFile(file, JSON.stringify(job));
  return { root, source, prepared: await prepareVoiceJob(file) };
}
function responseFetch(onCall = () => {}, customWords = words()) {
  return async (url, options) => {
    onCall(url, options);
    return new Response(JSON.stringify({ code: 0, data: mp3.toString('base64'), sentence: { words: customWords } }) + '\n' + JSON.stringify({ code: 0, usage: { text_words: 3 } }),
      { status: 200, headers: { 'X-Tt-Logid': 'fixture-log' } });
  };
}

test('private dotenv supports comments/quotes without interpolation, duplicates or secret serialization', async () => {
  const env = parseVoiceEnv('# comment\nA=123 # note\nexport B="value"\nC=\'text\'\n');
  assert.equal(env.A, '123'); assert.equal(env.B, 'value');
  assert.throws(() => parseVoiceEnv('A=1\nA=2'), { code: 'INVALID_ENV' });
  assert.throws(() => parseVoiceEnv('not a declaration'), { code: 'INVALID_ENV' });
  const c = await config(); assert.equal(c.apiKey, 'fixture-only-not-a-real-key'); assert.ok(!JSON.stringify(c).includes(c.apiKey));
});
test('configuration readiness does not expose values and supports per-character voices', async () => {
  const c = await loadVoiceConfig(path.join(fixtureRoot, 'absent.env'), {});
  assert.deepEqual(voiceReadiness(c, ['VOLCENGINE_TTS_SPEAKER_NARRATOR']).missing, ['VOLCENGINE_TTS_API_KEY', 'VOLCENGINE_TTS_SPEAKER_NARRATOR']);
  assert.throws(() => voiceReadiness(c, ['VOLCENGINE_TTS_API_KEY']), { code: 'INVALID_CONFIG' });
  await assert.rejects(loadVoiceConfig(path.join(fixtureRoot, 'absent.env'), { VOLCENGINE_TTS_SPEECH_RATE: '101' }), { code: 'INVALID_CONFIG' });
  const wrong = await config(); wrong.voices.VOLCENGINE_TTS_SPEAKER_NARRATOR = wrong.apiKey;
  assert.throws(() => voiceReadiness(wrong, ['VOLCENGINE_TTS_SPEAKER_NARRATOR']), { code: 'INVALID_CONFIG' });
});
test('HTTP JSON decoder handles arbitrary chunk/UTF8 boundaries, quoted braces and adjacent objects', async () => {
  const bytes = Buffer.from(' \n{"code":0,"message":"中文{\\\"}"}{"code":0}\n');
  const body = (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })();
  const items = []; for await (const value of jsonObjects(body)) items.push(value);
  assert.equal(items.length, 2); assert.equal(items[0].message, '中文{"}');
  await assert.rejects(async () => { for await (const value of jsonObjects((async function* () { yield Buffer.from('{"code":'); })())) void value; }, { code: 'TTS_PROTOCOL' });
});
test('API Key HTTP request enables provider subtitle timestamps and never redirects credentials', async () => {
  let calls = 0;
  const c = await config();
  const r = await synthesizeUtterance(c, { text: '看一看。', speakerEnv: 'VOLCENGINE_TTS_SPEAKER_NARRATOR' }, { fetchImpl: responseFetch((url, opts) => {
    calls += 1; assert.equal(url, TTS_ENDPOINT); assert.equal(opts.redirect, 'error'); assert.equal(opts.headers['X-Api-Key'], c.apiKey);
    const body = JSON.parse(opts.body); assert.equal(body.req_params.speaker, 'fixture-voice'); assert.equal(body.req_params.audio_params.enable_subtitle, true); assert.equal(body.req_params.audio_params.format, 'mp3');
  }) });
  assert.equal(calls, 1); assert.deepEqual(r.audio, mp3); assert.equal(r.logId, 'fixture-log'); assert.ok(!JSON.stringify(r.request).includes(c.apiKey));
});
test('live V3 CodeOK and mixed HTTP success chunks preserve audio/timestamps, not pending or string codes', async () => {
  const c = await config(); const item = { text: '看一看。', speakerEnv: 'VOLCENGINE_TTS_SPEAKER_NARRATOR' };
  for (const firstCode of [0, 20000000]) {
    let calls = 0;
    const result = await synthesizeUtterance(c, item, { fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ code: firstCode, data: mp3.toString('base64'), sentence: { words: words() } }) + '\n' + JSON.stringify({ code: 20000000, usage: { text_words: 3 } }));
    } });
    assert.equal(calls, 1); assert.deepEqual(result.audio, mp3); assert.deepEqual(result.sentences, [{ words: words() }]);
    assert.deepEqual(result.responseCodes, firstCode === 0 ? [0, 20000000] : [20000000]);
  }
  for (const code of [20000001, 45000001, '20000000', null]) {
    let calls = 0;
    await assert.rejects(synthesizeUtterance(c, item, { fetchImpl: async () => {
      calls += 1; return new Response(JSON.stringify({ code, message: c.apiKey }));
    } }), (e) => e.code === 'TTS_PROVIDER' && !e.message.includes(c.apiKey));
    assert.equal(calls, 1);
  }
  await assert.rejects(synthesizeUtterance(c, item, { fetchImpl: async () => new Response('{"code":20000000}') }), { code: 'TTS_AUDIO_MISSING' });
});
test('missing key/voice blocks network even when the provider adapter is called directly', async () => {
  const c = await loadVoiceConfig(path.join(fixtureRoot, 'absent.env'), {}); let calls = 0;
  await assert.rejects(synthesizeUtterance(c, { text: '你好', speakerEnv: 'VOLCENGINE_TTS_SPEAKER_NARRATOR' }, { fetchImpl: async () => { calls += 1; } }), { code: 'MISSING_CONFIG' });
  assert.equal(calls, 0);
});
test('provider errors and broken streams are redacted and never retried', async () => {
  const c = await config(); let calls = 0;
  await assert.rejects(synthesizeUtterance(c, { text: '看一看。', speakerEnv: 'VOLCENGINE_TTS_SPEAKER_NARRATOR' }, { fetchImpl: async () => {
    calls += 1; return new Response(JSON.stringify({ code: 123, message: c.apiKey }), { status: 200 });
  } }), (e) => e.code === 'TTS_PROVIDER' && !e.message.includes(c.apiKey));
  assert.equal(calls, 1);
  await assert.rejects(synthesizeUtterance(c, { text: '看一看。', speakerEnv: 'VOLCENGINE_TTS_SPEAKER_NARRATOR' }, { fetchImpl: async () => { throw new Error(c.apiKey); } }), (e) => e.code === 'TTS_NETWORK' && !e.message.includes(c.apiKey));
});
test('HTTP failures, invalid audio and timeout never leak a key or trigger retries', async () => {
  const c = await config(); const item = { text: '看一看。', speakerEnv: 'VOLCENGINE_TTS_SPEAKER_NARRATOR' };
  await assert.rejects(synthesizeUtterance(c, item, { fetchImpl: async () => new Response(c.apiKey, { status: 401 }) }), (e) => e.code === 'TTS_HTTP' && !e.message.includes(c.apiKey));
  await assert.rejects(synthesizeUtterance(c, item, { fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: '!*' })) }), { code: 'TTS_PROTOCOL' });
  c.timeoutMs = 10; let calls = 0;
  await assert.rejects(synthesizeUtterance(c, item, { fetchImpl: async (_url, options) => {
    calls += 1; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error(c.apiKey)), { once: true }));
  } }), (e) => e.code === 'TTS_TIMEOUT' && !e.message.includes(c.apiKey));
  assert.equal(calls, 1);
});
test('timestamp normalization deduplicates cumulative words but rejects missing, backward, overflow or wrong text', () => {
  const normalized = normalizeWords([{ words: words() }, { words: words() }], 700, '看一看。'); assert.equal(normalized.length, 3);
  assert.throws(() => normalizeWords([], 700, '看一看。'), { code: 'TIMESTAMPS_MISSING' });
  assert.throws(() => normalizeWords([{ words: [{ word: '看', startTime: 0.5, endTime: 0.8 }] }], 700, '看'), { code: 'TIMESTAMP_OVERFLOW' });
  assert.throws(() => normalizeWords([{ words: [words()[1], words()[0]] }], 700, '一看'), { code: 'TIMESTAMP_ORDER' });
  assert.throws(() => normalizeWords([{ words: words() }], 700, '别的台词'), { code: 'TRANSCRIPT_MISMATCH' });
  assert.throws(() => normalizeWords([{ words: [{ word: '看', start_ms: 0, end_ms: 100 }] }], 700, '看'), { code: 'INVALID_TIMESTAMP' });
});
test('subtitle groups, JSON/SRT/VTT use actual word times and editorial offsets, not text length', () => {
  const normalized = normalizeWords([{ words: words() }], 700, '看一看。');
  const cues = wordCaptions(normalized, voiceJob().segments[0], 14);
  assert.equal(cues[0].start_ms, 550); assert.equal(cues[0].end_ms, 1150);
  const document = validateSubtitles({ schema_version: '0.1', time_unit: 'ms', episode_id: 'voice-test', segments: cues }, 4000);
  assert.match(subtitleText(document, 'srt'), /00:00:00,550 --> 00:00:01,150/); assert.match(subtitleText(document, 'vtt'), /^WEBVTT/);
  assert.throws(() => validateSubtitles({ ...document, segments: [{ ...cues[0], end_ms: 5000 }] }, 4000), { code: 'INVALID_SUBTITLES' });
  assert.throws(() => validateSubtitles({ ...document, segments: [cues[0], cues[0]] }, 4000), { code: 'INVALID_SUBTITLES' });
});
test('bilingual subtitles preserve Chinese timing and export Chinese above English', () => {
  const cue = wordCaptions(normalizeWords([{ words: words() }], 700, '看一看。'), voiceJob().segments[0])[0];
  const document = { schema_version: '0.1', time_unit: 'ms', episode_id: 'voice-test', segments: [{ ...cue, text_en: 'Take a look.' }] };
  validateSubtitles(document, 4000);
  for (const format of ['srt', 'vtt']) assert.match(subtitleText(document, format), /看一看。\nTake a look\./);
  assert.equal(document.segments[0].start_ms, 550); assert.equal(document.segments[0].end_ms, 1150);
  for (const text_en of ['', null, 3, 'bad\ncue', 'bad\u0001cue', 'x'.repeat(501)]) {
    assert.throws(() => validateSubtitles({ ...document, segments: [{ ...cue, text_en }] }, 4000), { code: 'INVALID_SUBTITLES' });
  }
  assert.throws(() => validateSubtitles({ ...document, segments: [document.segments[0], { ...cue, start_ms: 1600, end_ms: 2200 }] }, 4000), { code: 'INVALID_SUBTITLES' });
});

test('bilingual caption layout has no plate, escapes both languages and keeps framework timing', () => {
  const cue = wordCaptions(normalizeWords([{ words: words() }], 700, '看一看。'), voiceJob().segments[0])[0];
  const output = withVoiceLayers(html(), { segments: [{ ...cue, text_en: '<script>Look & see</script>' }] }, baseJob().target, 'font.ttc');
  assert.match(output, /background:transparent/); assert.ok(!output.includes('background:#fff9e9'));
  assert.match(output, /lang="zh-CN">看一看。<\/div><div data-hf-id="voice-layer-en-0" class="voice-caption-en" lang="en">&lt;script&gt;Look &amp; see&lt;\/script&gt;/);
  assert.match(output, /data-hf-id="voice-layer-zh-0"/);
  assert.match(output, /data-start="0.55"/);
  assert.ok(output.includes(`data-duration="${(subtitleDisplayEnd({ ...cue, text_en: '<script>Look & see</script>' }, undefined, 4000) - cue.start_ms) / 1000}"`));
  assert.match(output, /data-speech-end-ms="1150"/);
  assert.match(output, /voice-caption-en\{font-size:38px/); assert.ok(!output.includes('font-style:italic'));
  assert.match(output, /bottom:70px/); assert.match(output, /text-wrap:balance/);
  assert.match(output, /class="voice-caption voice-caption-bilingual"/);
  assert.match(output, /grid-template-rows:140\.4px 102\.6px/);
  assert.match(output, /voice-caption-bilingual \.voice-caption-zh\{align-self:end\}/);
  assert.match(output, /voice-caption-bilingual \.voice-caption-en\{align-self:start\}/);
  const capped = withVoiceLayers(html(), { segments: [{ ...cue, text_en: 'Look.' }, { ...cue, start_ms: 1300, end_ms: 1800, text_en: 'See.' }] }, baseJob().target, 'font.ttc');
  assert.match(capped, /data-start="0.55" data-duration="0.75"/);
  assert.equal(cue.end_ms, 1150);
  assert.ok(!output.includes('setTimeout')); assert.ok(!output.includes('.play('));
});

test('bilingual reading budget uses code points, preserves speech boundaries and respects next cue/tail', () => {
  const cue = { start_ms: 1000, end_ms: 1500, text_en: 'x'.repeat(51) };
  assert.equal(subtitleDisplayEnd(cue, 6000, 8000), 4000);
  assert.equal(subtitleDisplayEnd({ ...cue, text_en: 'Yes.' }, 6000, 8000), 2800);
  assert.equal(subtitleDisplayEnd({ ...cue, text_en: '🙂'.repeat(34) }, 6000, 8000), 3000);
  assert.equal(subtitleDisplayEnd(cue, 2500, 8000), 2500);
  assert.equal(subtitleDisplayEnd(cue, undefined, 2000), 2000);
  assert.equal(subtitleDisplayEnd({ start_ms: 1000, end_ms: 1500 }, undefined, 8000), 1500);
});

test('long Chinese captions wrap at short clauses with stable unique markers and unchanged text', () => {
  const cue = { scene_id: 'yard', speaker: 'narrator', text: '她想着，只要再小一点，就能放得下了。', text_en: 'She thought she would fit.',
    start_ms: 500, end_ms: 2500, audio_path: 'audio/line.wav' };
  const output = withVoiceLayers(html(), { segments: [cue] }, baseJob().target, 'font.ttc');
  assert.match(output, /class="voice-caption-phrase">只要再小一点，<\/span>/);
  assert.match(output, /voice-caption-phrase\{white-space:nowrap\}/);
  const markers = [...output.matchAll(/data-hf-id="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(markers).size, markers.length);
  const chinese = output.match(/class="voice-caption-zh" lang="zh-CN">(.*?)<\/div>/s)[1].replace(/<[^>]*>/g, '');
  assert.equal(chinese, cue.text);
  const long = withVoiceLayers(html(), { segments: [{ ...cue, text: '长'.repeat(30) + '。' }] }, baseJob().target, 'font.ttc');
  assert.ok(!long.includes('class="voice-caption-phrase">'));
});

test('explicit editorial reading end exports consistently without altering native speech timestamps', () => {
  const cue = { scene_id: 'yard', speaker: 'narrator', text: '看。', text_en: 'Look.', start_ms: 500,
    end_ms: 1000, display_end_ms: 2300, audio_path: 'audio/line.wav' };
  const document = { schema_version: '0.1', time_unit: 'ms', episode_id: 'voice-test', segments: [cue] };
  validateSubtitles(document, 4000);
  assert.match(subtitleText(document, 'srt'), /00:00:00,500 --> 00:00:02,300/);
  assert.match(subtitleText(document, 'vtt'), /00:00:00\.500 --> 00:00:02\.300/);
  assert.equal(subtitleDisplayEnd(cue, undefined, 4000), 2300); assert.equal(cue.end_ms, 1000);
  const output = withVoiceLayers(html(), document, baseJob().target, 'font.ttc');
  assert.match(output, /data-start="0.5" data-duration="1.8" data-speech-end-ms="1000"/);
  for (const display_end_ms of [999, 4001, 1200.5, null]) {
    assert.throws(() => validateSubtitles({ ...document, segments: [{ ...cue, display_end_ms }] }, 4000), { code: 'INVALID_SUBTITLES' });
  }
  assert.throws(() => validateSubtitles({ ...document, segments: [cue, { ...cue, start_ms: 2000, end_ms: 2600, display_end_ms: 3000 }] }, 4000), { code: 'INVALID_SUBTITLES' });
});

test('voice job rejects unknown speakers, overlapping slots, bad IDs and formal production', () => {
  assert.equal(validateVoiceJob(voiceJob(), baseJob()).durationMs, 4000);
  const clone = structuredClone(voiceJob()); clone.segments.push({ ...clone.segments[0], id: 'line-2' });
  assert.throws(() => validateVoiceJob(clone, baseJob()), { code: 'INVALID_VOICE_JOB' });
  clone.segments = [{ ...clone.segments[0], speaker: 'unknown' }]; assert.throws(() => validateVoiceJob(clone, baseJob()));
  assert.throws(() => validateVoiceJob({ ...voiceJob(), purpose: 'production' }, baseJob()));
});
test('voice render reference cannot follow a symlink outside its job directory', async (t) => {
  const { root, source } = await project(t);
  await writeFile(path.join(root, 'outside.json'), JSON.stringify(baseJob()));
  await symlink(path.join(root, 'outside.json'), path.join(source, 'escape.json'));
  await writeFile(path.join(source, 'escape-voice.json'), JSON.stringify({ ...voiceJob(), render_job: 'escape.json' }));
  await assert.rejects(prepareVoiceJob(path.join(source, 'escape-voice.json')), { code: 'SYMLINK_ESCAPE' });
});
test('missing synthesis config creates no output or calls', async (t) => {
  const { root, prepared } = await project(t); let calls = 0;
  const options = { fetchImpl: responseFetch(() => { calls += 1; }), fixture: true };
  const empty = await loadVoiceConfig(path.join(fixtureRoot, 'absent.env'), {});
  await assert.rejects(synthesizeVoice(prepared, empty, path.join(root, 'run'), options), { code: 'MISSING_CONFIG' });
  assert.equal(calls, 0); await assert.rejects(access(path.join(root, 'run')));
});
test('WAV assembly measures actual PCM samples and rejects malformed audio', () => {
  const pcm = Buffer.alloc(24000 * 2); const actual = readPcmWave(pcmWave(pcm)); assert.equal(actual.durationMs, 1000);
  assert.throws(() => readPcmWave(Buffer.from('not audio')), { code: 'INVALID_AUDIO' });
  assert.throws(() => readPcmWave(pcmWave(pcm).subarray(0, 50)), { code: 'INVALID_AUDIO' });
});
test('mocked full worker produces exact-duration audio and real fixture timestamps with no secrets or overwrite', async (t) => {
  const { root, prepared } = await project(t); let calls = 0;
  const c = await config(), out = path.join(root, 'run'); const options = { fixture: true, fetchImpl: responseFetch(() => { calls += 1; }) };
  const result = await synthesizeVoice(prepared, c, out, options);
  assert.equal(result.manifest.status, 'completed'); assert.equal(result.manifest.live_provider_call, false); assert.equal(calls, 1);
  assert.equal(readPcmWave(await readFile(path.join(out, 'audio/track.wav'))).durationMs, 4000);
  const captions = JSON.parse(await readFile(path.join(out, 'subtitles.json'), 'utf8')); assert.equal(captions.segments[0].start_ms, 550);
  assert.ok(!(await readFile(path.join(out, 'manifest.json'), 'utf8')).includes(c.apiKey));
  await assert.rejects(synthesizeVoice(prepared, c, out, options), { code: 'EEXIST' }); assert.equal(calls, 1);
});
test('actual audio slot overflow preserves failed evidence and never truncates or requests later lines', async (t) => {
  const job = voiceJob(); job.segments[0].end_ms = 600;
  const { root, prepared } = await project(t, job); const out = path.join(root, 'run'); let calls = 0;
  await assert.rejects(synthesizeVoice(prepared, await config(), out, { fixture: true, fetchImpl: responseFetch(() => { calls += 1; }) }), { code: 'VOICE_SLOT_OVERFLOW' });
  assert.equal(calls, 1); const failed = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8')); assert.equal(failed.status, 'failed'); assert.ok(failed.utterances[0].duration_ms > 100);
  await access(path.join(out, 'audio/line-1.wav')); await assert.rejects(access(path.join(out, 'subtitles.json')));
  await access(path.join(out, 'responses/line-1.json'));
});
test('missing provider timestamps preserve audio but cannot produce a completed voice/subtitle run', async (t) => {
  const { root, prepared } = await project(t); const out = path.join(root, 'run');
  await assert.rejects(synthesizeVoice(prepared, await config(), out, { fixture: true, fetchImpl: responseFetch(() => {}, []) }), { code: 'TIMESTAMPS_MISSING' });
  await access(path.join(out, 'audio/line-1.wav')); await assert.rejects(access(path.join(out, 'subtitles.json')));
});
test('changed animation blocks paid requests before network or output creation', async (t) => {
  const { root, source, prepared } = await project(t); await writeFile(path.join(source, 'index.html'), html() + '<!-- new source -->'); let calls = 0;
  await assert.rejects(synthesizeVoice(prepared, await config(), path.join(root, 'run'), { fixture: true, fetchImpl: responseFetch(() => { calls += 1; }) }), { code: 'STALE_VOICE_JOB' });
  assert.equal(calls, 0);
});
test('source mutation during a returned response invalidates the completed-looking voice files', async (t) => {
  const { root, source, prepared } = await project(t); const out = path.join(root, 'run');
  const fake = responseFetch();
  await assert.rejects(synthesizeVoice(prepared, await config(), out, { fixture: true, fetchImpl: async (...args) => {
    await writeFile(path.join(source, 'index.html'), html() + '<!-- changed while synthesizing -->'); return fake(...args);
  } }), { code: 'STALE_VOICE_JOB' });
  const record = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8')); assert.equal(record.status, 'failed');
  await assert.rejects(attachVoice(path.join(source, 'job.json'), out, path.join(root, 'av')), { code: 'STALE_VOICE_RUN' });
});
test('HyperFrames caption insertion is escaped, locally-fonted, above scene, timed and does not start a clock', () => {
  const cues = wordCaptions(normalizeWords([{ words: words() }], 700, '看一看。'), voiceJob().segments[0]); cues[0].text = '<script>不是代码</script>';
  const document = { segments: cues }, output = withVoiceLayers(html(), document, baseJob().target, 'font.ttc');
  assert.match(output, /&lt;script&gt;/); assert.match(output, /z-index:10000/); assert.match(output, /data-start="0.55"/); assert.match(output, /data-duration="0.6"/);
  assert.match(output, /id="voice-track"/); assert.match(output, /@font-face/); assert.ok(!output.includes('.play('));
  assert.throws(() => withVoiceLayers(output, document, baseJob().target, 'font.ttc'), { code: 'ALREADY_HAS_AUDIO' });
});
test('attachment copies to a new AV project, keeps silent source unchanged and rejects altered outputs', async (t) => {
  const { root, source, prepared } = await project(t); const out = path.join(root, 'run');
  await synthesizeVoice(prepared, await config(), out, { fixture: true, fetchImpl: responseFetch() });
  const original = await readFile(path.join(source, 'index.html'));
  const result = await attachVoice(path.join(source, 'job.json'), out, path.join(root, 'av'));
  const av = await prepareJob(result.job); assert.equal(av.job.expect_audio, true); assert.ok(av.job.assets.some((s) => s.startsWith('assets/voice-font')));
  assert.deepEqual(await readFile(path.join(source, 'index.html')), original);
  await writeFile(path.join(out, 'subtitles.json'), '{}'); await assert.rejects(attachVoice(path.join(source, 'job.json'), out, path.join(root, 'av2')), { code: 'VOICE_OUTPUT_CHANGED' });
});
test('voice CLI rejects unknown, repeated, cross-operation and missing arguments', () => {
  assert.equal(parseVoiceArgs(['check']).action, 'check');
  for (const args of [['synthesize'], ['attach', '--out', 'x'], ['check', '--allow-paid'], ['check', '--job', 'a', '--job', 'b'], ['unknown'], ['check', '--key', 'do-not-print']]) assert.throws(() => parseVoiceArgs(args));
  assert.throws(() => parseVoiceArgs(['check', '--fixture-only-private-key=not-for-output']), (e) => !e.message.includes('not-for-output'));
});

test('2.0 direction is additions JSON, separate from spoken text and timing', async () => {
  const c = await config(); c.voices.VOLCENGINE_TTS_SPEAKER_NARRATOR = 'zh_female_fixture_uranus_bigtts';
  const direction = '用温柔、好奇的语气说，不夸张。';
  const r = await synthesizeUtterance(c, { text: '看一看。', speakerEnv: 'VOLCENGINE_TTS_SPEAKER_NARRATOR', voice_direction: direction }, { fetchImpl: responseFetch((_url, opts) => {
    const req = JSON.parse(opts.body).req_params;
    assert.equal(req.text, '看一看。'); assert.equal(typeof req.additions, 'string'); assert.deepEqual(JSON.parse(req.additions), { context_texts: [direction] });
    assert.ok(!Object.hasOwn(req.audio_params, 'emotion')); assert.ok(!Object.hasOwn(req, 'context_texts'));
  }) });
  assert.equal(r.sentences[0].words.length, 3);
});
test('public Chinese ICL uranus 2.0 catalogue voices retain direction without a clone resource', async () => {
  const c = await config(); c.voices.VOLCENGINE_TTS_SPEAKER_NARRATOR = 'ICL_uranus_zh_female_fixture_tob';
  let calls = 0;
  await synthesizeUtterance(c, { text: '看一看。', speakerEnv: 'VOLCENGINE_TTS_SPEAKER_NARRATOR', voice_direction: '温柔自然地讲述。' }, { fetchImpl: responseFetch((_url, opts) => {
    calls++; assert.equal(opts.headers['X-Api-Resource-Id'], 'seed-tts-2.0');
    const request = JSON.parse(opts.body).req_params;
    assert.equal(request.speaker, 'ICL_uranus_zh_female_fixture_tob');
    assert.deepEqual(JSON.parse(request.additions), { context_texts: ['温柔自然地讲述。'] });
    assert.ok(!Object.hasOwn(request, 'model'));
  }) });
  assert.equal(calls, 1);
  c.resourceId = 'seed-icl-2.0';
  await assert.rejects(synthesizeUtterance(c, { text: '看一看。', speakerEnv: 'VOLCENGINE_TTS_SPEAKER_NARRATOR', voice_direction: '温柔自然地讲述。' }), { code: 'UNSUPPORTED_VOICE_DIRECTION' });
});

test('direction format, leaked credentials and unsupported voice/resource fail before any network', async () => {
  const c = await config(); const item = { text: '看一看。', speakerEnv: 'VOLCENGINE_TTS_SPEAKER_NARRATOR' }; let calls = 0;
  const opts = { fetchImpl: async () => { calls += 1; throw new Error('must not request'); } };
  for (const voice_direction of ['', null, 'x\ny', 'x'.repeat(401)]) await assert.rejects(synthesizeUtterance(c, { ...item, voice_direction }, opts), { code: 'INVALID_VOICE_DIRECTION' });
  await assert.rejects(synthesizeUtterance(c, { ...item, voice_direction: c.apiKey }, opts), { code: 'SECRET_IN_TEXT' });
  await assert.rejects(synthesizeUtterance(c, { ...item, voice_direction: '开心地说' }, opts), { code: 'UNSUPPORTED_VOICE_DIRECTION' });
  c.voices[item.speakerEnv] = 'zh_female_fixture_uranus_bigtts'; c.resourceId = 'seed-icl-2.0';
  await assert.rejects(synthesizeUtterance(c, { ...item, voice_direction: '开心地说' }, opts), { code: 'UNSUPPORTED_VOICE_DIRECTION' });
  assert.equal(calls, 0);
});
test('all batch direction capabilities are checked before first paid line/output', async (t) => {
  const job = voiceJob(); job.segments.push({ ...job.segments[0], id: 'line-2', start_ms: 1600, end_ms: 3000, voice_direction: '高兴地说' });
  const { prepared, root } = await project(t, job); let calls = 0;
  await assert.rejects(synthesizeVoice(prepared, await config(), path.join(root, 'run'), { fixture: true, fetchImpl: responseFetch(() => calls++) }), { code: 'UNSUPPORTED_VOICE_DIRECTION' });
  assert.equal(calls, 0); await assert.rejects(access(path.join(root, 'run')));
});
test('generic provider registry is explicit and shared audio lifecycle accepts a different adapter format', async (t) => {
  assert.deepEqual(listTtsProviders().map(x => x.id), ['volcengine']); assert.equal(getTtsProvider().id, 'volcengine');
  assert.throws(() => getTtsProvider('not-implemented'), { code: 'UNSUPPORTED_TTS_PROVIDER' });
  const root = await mkdtemp(path.join(os.tmpdir(), 'other-tts-')); t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const other = { id: 'test-other', audioFormat: 'wav', readiness: () => ({ ready: true, missing: [] }), validate() {},
    synthesize: async (_c, _i, opts) => { calls++; return { audio: pcmWave(Buffer.alloc(24000 * 2)), requestId: opts.requestId, request: { fixture: true } }; },
    normalizeTimings: (_r, duration) => { assert.equal(duration, 1000); return [{ text: '看一看。', start_ms: 100, end_ms: 600, confidence: null }]; } };
  const result = await synthesizeSpeech(other, {}, { text: '看一看。', speakerEnv: 'OTHER_VOICE' }, path.join(root, 'audio'), { requestId: 'fixture' });
  assert.equal(calls, 1); assert.equal(result.durationMs, 1000); assert.equal(result.words[0].start_ms, 100); assert.ok(result.original.endsWith('.source.wav')); assert.ok(result.normalized.endsWith('/audio.wav'));
});
test('standalone TTS runs without payment opt-in and keeps hashes, stale-input and reuse guards', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tts-job-')); t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'job.json');
  const job = { schema_version: '0.1', id: 'tts-test', artifact_version: 'tts-test-v1', purpose: 'technical_validation', provider: 'volcengine', speaker_env: 'VOLCENGINE_TTS_SPEAKER_NARRATOR', text: '看一看。' };
  await writeFile(file, JSON.stringify(job)); const p = await prepareTtsJob(file); let calls = 0;
  const opts = { fixture: true, fetchImpl: responseFetch(() => calls++) }; const c = await config();
  const out = path.join(root, 'run'); const r = await runTtsJob(p, c, out, opts); assert.equal(r.manifest.status, 'completed'); assert.equal(r.manifest.live_provider_call, false); assert.equal(calls, 1);
  assert.equal(readPcmWave(await readFile(path.join(out, 'speech.wav'))).durationMs, r.manifest.duration_ms); assert.ok(r.manifest.output['speech-response.json'].sha256);
  await assert.rejects(runTtsJob(p, c, out, opts), { code: 'EEXIST' }); assert.equal(calls, 1);
  await writeFile(file, JSON.stringify({ ...job, text: '变更' })); await assert.rejects(runTtsJob(p, c, path.join(root, 'stale'), opts), { code: 'STALE_TTS_JOB' }); assert.equal(calls, 1);
});
test('standalone TTS errors preserve received audio without fake timing success', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tts-errors-')); t.after(() => rm(root, { recursive: true, force: true })); const file = path.join(root, 'job.json');
  await writeFile(file, JSON.stringify({ schema_version: '0.1', id: 'tts-errors', artifact_version: 'tts-errors-v1', purpose: 'exploration', speaker_env: 'VOLCENGINE_TTS_SPEAKER_NARRATOR', text: '看一看。' }));
  const out = path.join(root, 'run'); await assert.rejects(runTtsJob(await prepareTtsJob(file), await config(), out, { fixture: true, fetchImpl: responseFetch(() => {}, []) }), { code: 'TIMESTAMPS_MISSING' });
  assert.equal(JSON.parse(await readFile(path.join(out, 'manifest.json'))).status, 'failed'); await access(path.join(out, 'speech.mp3')); await access(path.join(out, 'speech.wav'));
});
test('standalone TTS CLI rejects secret-bearing, duplicate and mismatched flags safely', () => {
  assert.equal(parseTtsArgs(['providers']).action, 'providers'); assert.equal(parseTtsArgs(['check']).action, 'check');
  assert.equal(parseTtsArgs(['synthesize','--out','new']).action, 'synthesize');
  assert.throws(() => parseTtsArgs(['synthesize','--out','new','--allow-paid']));
  for (const args of [['synthesize'], ['providers', '--env', 'x'], ['check', '--allow-paid'], ['check', '--job', 'a', '--job', 'b'], ['check', '--key', 'never-print']]) assert.throws(() => parseTtsArgs(args), e => !e.message.includes('never-print'));
});
