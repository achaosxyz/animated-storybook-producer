import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { runCommand } from '../src/runtime.mjs';
import { pcmWave } from '../src/audio.mjs';
import { ASR_ENDPOINT, loadAsrConfig, asrReadiness, recognizeVolcengine, normalizeAsr } from '../src/volcengine-asr.mjs';
import { getAsrProvider, prepareAsrAudio, runAsr } from '../src/asr.mjs';
import { parseAsrArgs } from '../scripts/asr.mjs';

const config = () => loadAsrConfig('/nonexistent/asr-fixture.env', { VOLCENGINE_ASR_API_KEY: 'fixture-asr-not-a-real-key' });
const payload = () => ({ result: { text: '看一看。', utterances: [{ text: '看一看。', start_time: 100, end_time: 700,
  words: [{ text: '看', start_time: 100, end_time: 300 }, { text: '一', start_time: 300, end_time: 500 }, { text: '看。', start_time: 500, end_time: 700 }] }] } });
function responsePacket(value = {}, { last = false, compression = 1, flags = last ? 3 : 1, type = 9, code = 45000001, event = false } = {}) {
  const body = compression ? gzipSync(Buffer.from(JSON.stringify(value))) : Buffer.from(JSON.stringify(value));
  const numbers = [...(flags & 1 ? [last ? -3 : 1] : []), ...(event ? [7] : []), ...(type === 15 ? [code] : []), body.length];
  const fields = Buffer.alloc(numbers.length * 4); numbers.forEach((n, i) => fields.writeInt32BE(n, i * 4));
  return Buffer.concat([Buffer.from([0x11, (type << 4) | flags, 0x10 | compression, 0]), fields, body]);
}
function clientValue(packet) {
  assert.equal(packet[0], 0x11); assert.equal(packet.readUInt32BE(8), packet.length - 12);
  return { type: packet[1] >> 4, flags: packet[1] & 15, sequence: packet.readInt32BE(4), bytes: gunzipSync(packet.subarray(12)) };
}
const wsFixture = (onCall = () => {}, value = payload(), onPacket = () => {}) => (url, options) => {
  onCall(url, options);
  const socket = new EventEmitter(); socket.terminated = false;
  socket.terminate = () => { socket.terminated = true; };
  socket.send = (packet, _options, callback) => {
    const p = clientValue(packet); onPacket(p, socket); callback();
    queueMicrotask(() => {
      if (socket.terminated) return;
      if (p.type === 1) socket.emit('message', responsePacket({}), true);
      else if (p.flags === 3) socket.emit('message', responsePacket(value, { last: true }), true);
      else socket.emit('message', responsePacket({ result: { text: '中间文本不会拼入最终转写' } }), true);
    });
  };
  queueMicrotask(() => socket.emit('open'));
  return socket;
};
async function audioFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asr-fixture-')); t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'tone-not-speech.wav'); await writeFile(file, pcmWave(Buffer.alloc(24000 * 2))); return { root, file, audio: await prepareAsrAudio(file) };
}
test('ASR config keeps key private and rejects bad resource/timeout without network', async () => {
  const c = await config(); assert.ok(!JSON.stringify(c).includes(c.apiKey)); assert.equal(asrReadiness(c).ready, true);
  assert.deepEqual(asrReadiness(await loadAsrConfig('/nonexistent/asr-fixture.env', {})).missing, ['VOLCENGINE_ASR_API_KEY']);
  await assert.rejects(loadAsrConfig('/nonexistent/asr-fixture.env', { VOLCENGINE_ASR_RESOURCE_ID: 'wrong' }), { code: 'INVALID_CONFIG' });
  await assert.rejects(loadAsrConfig('/nonexistent/asr-fixture.env', { VOLCENGINE_ASR_TIMEOUT_MS: '0' }), { code: 'INVALID_CONFIG' });
  await assert.rejects(loadAsrConfig('/nonexistent/asr-fixture.env', { VOLCENGINE_ASR_RESOURCE_ID: 'volc.bigasr.auc_turbo' }), { code: 'INVALID_CONFIG' });
  for (const resource of ['volc.seedasr.sauc.concurrent', 'volc.bigasr.sauc.duration', 'volc.bigasr.sauc.concurrent']) {
    assert.equal((await loadAsrConfig('/nonexistent/asr-fixture.env', { VOLCENGINE_ASR_RESOURCE_ID: resource })).resourceId, resource);
  }
});
test('ASR streams local PCM with fixed auth, ordered binary packets and final-only full results', async (t) => {
  const { audio } = await audioFixture(t); const c = await config(); let calls = 0, socket; const packets = [], times = [];
  const r = await recognizeVolcengine(c, audio, { requestId: 'fixture-request', webSocketFactory: wsFixture((url, opts) => {
    calls++; assert.equal(url, ASR_ENDPOINT); assert.equal(opts.followRedirects, false); assert.equal(opts.headers['X-Api-Key'], c.apiKey);
    assert.equal(opts.headers['X-Api-Resource-Id'], 'volc.seedasr.sauc.duration'); assert.equal(opts.headers['X-Api-Request-Id'], 'fixture-request');
  }, payload(), (p, s) => { socket = s; packets.push(p); times.push(performance.now()); }) });
  assert.equal(socket.terminated, true);
  const body = JSON.parse(packets[0].bytes); assert.equal(body.audio.format, 'pcm'); assert.equal(body.audio.rate, 16000); assert.equal(body.audio.channel, 1);
  assert.equal(body.request.show_utterances, true); assert.equal(body.request.enable_ddc, false); assert.equal(body.request.enable_itn, false);
  assert.equal(body.request.result_type, 'full'); assert.equal(body.request.enable_nonstream, true); assert.ok(!body.audio.url); assert.ok(!body.audio.data);
  assert.deepEqual(packets.map(p => p.sequence), [1, 2, 3, 4, 5, -6]);
  assert.equal(packets.at(-1).flags, 3); assert.equal(packets[1].bytes.length, 6400);
  assert.deepEqual(Buffer.concat(packets.slice(1).map(p => p.bytes)), audio.streamBytes);
  assert.ok(times.at(-1) - times[1] >= 700);
  assert.equal(calls, 1); const transcript = normalizeAsr(r, audio.durationMs); assert.equal(transcript.source, 'asr'); assert.equal(transcript.segments[0].start_ms, 100); assert.equal(transcript.segments[0].words[2].end_ms, 700); assert.equal(transcript.segments[0].speaker, null);
  assert.equal(transcript.text, '看一看。');
  assert.ok(!JSON.stringify(r.request).includes(c.apiKey));
});
test('ASR handshake/provider/protocol errors, early close and timeout are redacted without retry', async (t) => {
  const { audio } = await audioFixture(t); const c = await config(); c.timeoutMs = 20;
  const variants = [
    [s => s.emit('unexpected-response', {}, { statusCode: 403, destroy() {} }), 'ASR_HTTP'],
    [s => s.emit('error', new Error(c.apiKey)), 'ASR_NETWORK'],
    [s => s.emit('message', responsePacket({ message: c.apiKey }, { type: 15 }), true), 'ASR_PROVIDER'],
    [s => s.emit('message', Buffer.from(c.apiKey), false), 'ASR_PROTOCOL'],
    [s => s.emit('message', Buffer.from('broken'), true), 'ASR_PROTOCOL'],
    [s => s.emit('message', responsePacket(payload(), { last: true }), true), 'ASR_PROTOCOL'],
    [s => s.emit('close'), 'ASR_NETWORK'],
    [() => {}, 'ASR_TIMEOUT'],
  ];
  for (const [trigger, code] of variants) {
    let calls = 0, socket; const listeners = process.listenerCount('SIGINT');
    await assert.rejects(recognizeVolcengine(c, audio, { requestId: 'fixture', webSocketFactory: () => {
      calls++; socket = new EventEmitter(); socket.terminate = () => { socket.terminated = true; };
      queueMicrotask(() => trigger(socket)); return socket;
    } }), e => e.code === code && !e.message.includes(c.apiKey));
    assert.equal(calls, 1); assert.equal(socket.terminated, true); assert.equal(process.listenerCount('SIGINT'), listeners);
  }
});
test('ASR requires actual millisecond times, rejects overlap/overflow/missing and does not invent words', () => {
  const good = { payload: payload() };
  assert.equal(normalizeAsr(good, 1000).segments.length, 1);
  for (const value of ['10', 1.5, -1]) { const p = payload(); p.result.utterances[0].start_time = value; assert.throws(() => normalizeAsr({ payload: p }, 1000), { code: 'INVALID_TIMESTAMP' }); }
  assert.throws(() => normalizeAsr(good, 600), { code: 'INVALID_TIMESTAMP' });
  const overlap = payload(); overlap.result.utterances.push(overlap.result.utterances[0]); assert.throws(() => normalizeAsr({ payload: overlap }, 1000), { code: 'INVALID_TIMESTAMP' });
  assert.throws(() => normalizeAsr({ payload: { result: { text: '看一看。' } } }, 1000), { code: 'TIMESTAMPS_MISSING' });
  const noWords = payload(); delete noWords.result.utterances[0].words; assert.deepEqual(normalizeAsr({ payload: noWords }, 1000).segments[0].words, []);
  assert.deepEqual(normalizeAsr({ payload: { result: { text: '', utterances: [] } } }, 1000).segments, []);
});
test('ASR input metadata validation rejects nonaudio data without leaking its content', async (t) => {
  const { root, audio } = await audioFixture(t); assert.equal(audio.durationMs, 1000); const fake = path.join(root, 'fake.wav'); await writeFile(fake, 'fixture-secret-content');
  await assert.rejects(prepareAsrAudio(fake), e => e.code === 'INVALID_ASR_AUDIO' && !e.message.includes('fixture-secret-content'));
});
test('ASR paid/missing-config/source-change guards block upload and output', async (t) => {
  const { root, file, audio } = await audioFixture(t); let calls = 0; const provider = getAsrProvider(), c = await config(), opts = { allowPaid: true, fixture: true, webSocketFactory: wsFixture(() => calls++) };
  await assert.rejects(runAsr(provider, c, audio, path.join(root, 'run'), { ...opts, allowPaid: false }), { code: 'PAID_RECOGNITION_NOT_AUTHORIZED' });
  await assert.rejects(runAsr(provider, await loadAsrConfig('/nonexistent/asr-fixture.env', {}), audio, path.join(root, 'run'), opts), { code: 'MISSING_CONFIG' });
  await writeFile(file, pcmWave(Buffer.alloc(24000 * 2, 1))); await assert.rejects(runAsr(provider, c, audio, path.join(root, 'run'), opts), { code: 'STALE_ASR_AUDIO' });
  assert.equal(calls, 0); await assert.rejects(access(path.join(root, 'run')));
});
test('ASR mock run creates JSON/text/SRT/VTT with pending review, no overwrite or auto attach', async (t) => {
  const { root, audio } = await audioFixture(t); const out = path.join(root, 'run'); let calls = 0;
  const opts = { allowPaid: true, fixture: true, webSocketFactory: wsFixture(() => calls++) }, provider = getAsrProvider(), c = await config();
  const r = await runAsr(provider, c, audio, out, opts); assert.equal(r.manifest.status, 'completed'); assert.equal(r.manifest.live_provider_call, false); assert.equal(r.manifest.character_speaker_mapping, null); assert.equal(calls, 1);
  assert.match(await readFile(path.join(out, 'subtitles.srt'), 'utf8'), /00:00:00,100 --> 00:00:00,700/); assert.equal(JSON.parse(await readFile(path.join(out, 'transcript.json'))).transcript_review, 'pending');
  await assert.rejects(runAsr(provider, c, audio, out, opts), { code: 'EEXIST' }); assert.equal(calls, 1);
});
test('ASR failed results retain request evidence and never fake a transcript', async (t) => {
  const { root, audio } = await audioFixture(t); const out = path.join(root, 'run');
  await assert.rejects(runAsr(getAsrProvider(), await config(), audio, out, { allowPaid: true, fixture: true, webSocketFactory: wsFixture(() => {}, { result: { text: '缺时间戳' } }) }), { code: 'TIMESTAMPS_MISSING' });
  assert.equal(JSON.parse(await readFile(path.join(out, 'manifest.json'))).status, 'failed'); await assert.rejects(access(path.join(out, 'subtitles.srt')));
});
test('ASR provider/CLI rejects unsupported adapters and secret-bearing or duplicate args', () => {
  assert.throws(() => getAsrProvider('missing'), { code: 'UNSUPPORTED_ASR_PROVIDER' }); assert.equal(parseAsrArgs(['check']).action, 'check');
  for (const args of [['recognize'], ['providers', '--env', 'x'], ['check', '--allow-paid'], ['check', '--audio', 'a', '--audio', 'b'], ['check', '--key', 'do-not-echo']]) assert.throws(() => parseAsrArgs(args), e => !e.message.includes('do-not-echo'));
});

test('ASR transcript/utterance/word disagreements block misleading cues', () => {
  const a = payload(); a.result.text = '不同台词'; assert.throws(() => normalizeAsr({ payload: a }, 1000), { code: 'TRANSCRIPT_MISMATCH' });
  const b = payload(); b.result.utterances[0].words[0].text = '别'; assert.throws(() => normalizeAsr({ payload: b }, 1000), { code: 'TRANSCRIPT_MISMATCH' });
});
test('ASR rejects known credentials embedded in audio before upload', async (t) => {
  const { root, file } = await audioFixture(t); const c = await config(); const pcm = Buffer.alloc(24000 * 2); Buffer.from(c.apiKey).copy(pcm, 100);
  await writeFile(file, pcmWave(pcm)); const audio = await prepareAsrAudio(file); let calls = 0;
  await assert.rejects(runAsr(getAsrProvider(), c, audio, path.join(root, 'run'), { allowPaid: true, fixture: true, webSocketFactory: wsFixture(() => calls++) }), { code: 'SECRET_IN_AUDIO' }); assert.equal(calls, 0);
});

test('ASR check normalizes WAV/MP3/OGG locally and records reproducible PCM hashes', async (t) => {
  const { root, file, audio } = await audioFixture(t);
  assert.equal(audio.streamBytes.length, 32000); assert.equal(audio.streamFormat, 'pcm'); assert.equal(audio.sampleRate, 16000);
  assert.equal((await prepareAsrAudio(file)).streamSha256, audio.streamSha256);
  for (const [extension, codec] of [['mp3', 'libmp3lame'], ['ogg', 'libopus']]) {
    const converted = path.join(root, `tone.${extension}`);
    await runCommand('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-c:a', codec, converted]);
    const prepared = await prepareAsrAudio(converted);
    assert.equal(prepared.format, extension); assert.equal(prepared.streamFormat, 'pcm');
    // Compressed containers can retain encoder padding when decoded from a pipe.
    // Subtitle bounds must follow the actual PCM sent, not a guessed original length.
    assert.ok(Math.abs(prepared.durationMs - 1000) < 50);
    assert.equal(prepared.durationMs, Math.floor(prepared.streamBytes.length / 32));
  }
});

test('ASR fixture and normalized-source guards cannot fall through to real networking', async (t) => {
  const { root, audio } = await audioFixture(t); const c = await config(); let calls = 0;
  await assert.rejects(runAsr(getAsrProvider(), c, audio, path.join(root, 'run'), { fixture: true, allowPaid: true }), { code: 'INVALID_TEST_TRANSPORT' });
  audio.streamBytes[0] ^= 1;
  await assert.rejects(runAsr(getAsrProvider(), c, audio, path.join(root, 'run'), { fixture: true, allowPaid: true,
    webSocketFactory: wsFixture(() => calls++) }), { code: 'STALE_ASR_AUDIO' });
  assert.equal(calls, 0); await assert.rejects(access(path.join(root, 'run')));
});

test('ASR accepts final frames without sequence and uncompressed/event responses', async (t) => {
  const { audio } = await audioFixture(t); const c = await config(); audio.streamBytes = audio.streamBytes.subarray(0, 1600);
  const factory = wsFixture(() => {}, payload(), (packet, socket) => {
    if (packet.type === 2) queueMicrotask(() => socket.emit('message', responsePacket(payload(), { last: true, flags: 6, event: true, compression: 0 }), true));
  });
  assert.equal((await recognizeVolcengine(c, audio, { requestId: 'fixture', webSocketFactory: factory })).payload.result.text, '看一看。');
});

test('ASR rejects corrupt sizes, gzip, JSON, unsupported framing and unconfirmed finals', async (t) => {
  const { audio } = await audioFixture(t); const c = await config(); audio.streamBytes = audio.streamBytes.subarray(0, 1600);
  const malformed = [];
  const length = responsePacket({}); length.writeUInt32BE(1234, 8); malformed.push(length);
  const gzip = responsePacket({}); gzip[12] = 0; malformed.push(gzip);
  const json = responsePacket({}, { compression: 0 }); json.fill(0xff, 12); malformed.push(json);
  const version = responsePacket({}); version[0] = 0x21; malformed.push(version);
  const type = responsePacket({}); type[1] = 0xa1; malformed.push(type);
  const compression = responsePacket({}); compression[2] = 0x12; malformed.push(compression);
  const pending = payload(); pending.result.utterances[0].definite = false;
  malformed.push(responsePacket(pending, { last: true }));
  for (const frame of malformed) {
    await assert.rejects(recognizeVolcengine(c, audio, { requestId: 'fixture', webSocketFactory: wsFixture(() => {}, payload(), (p, socket) => {
      if (p.type === 2) queueMicrotask(() => socket.emit('message', frame, true));
    }) }), { code: 'ASR_PROTOCOL' });
  }
});

test('ASR aborts sender and preserves failed manifest on disconnect after partial results', async (t) => {
  const { root, audio } = await audioFixture(t); const c = await config(); const out = path.join(root, 'failed-stream');
  let sent = 0, socket;
  const factory = wsFixture(() => {}, payload(), (p, s) => {
    socket = s; sent++;
    if (p.type === 2) queueMicrotask(() => { s.emit('message', responsePacket({ result: { text: '只有中间结果' } }), true); s.emit('close'); });
  });
  await assert.rejects(runAsr(getAsrProvider(), c, audio, out, { allowPaid: true, fixture: true, webSocketFactory: factory }), { code: 'ASR_NETWORK' });
  const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json')));
  assert.equal(manifest.status, 'failed'); assert.ok(manifest.request_id); assert.equal(manifest.input.stream_sha256, audio.streamSha256);
  assert.equal(socket.terminated, true); assert.equal(sent, 2); await assert.rejects(access(path.join(out, 'transcript.json')));
});

test('ASR handles an actual local WebSocket upgrade and binary round trip without cloud calls', async (t) => {
  const { audio } = await audioFixture(t); const c = await config(); const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { for (const client of server.clients) client.terminate(); return new Promise(resolve => server.close(resolve)); });
  let headers, received = [];
  server.on('connection', (socket, request) => {
    headers = request.headers;
    socket.on('message', data => {
      const packet = clientValue(data); received.push(packet);
      if (packet.type === 1) socket.send(responsePacket({}));
      else if (packet.flags === 3) socket.send(responsePacket(payload(), { last: true }));
      else socket.send(responsePacket({ result: { text: '临时文本' } }));
    });
  });
  const response = await recognizeVolcengine(c, audio, { requestId: 'local-ws-fixture',
    webSocketFactory: (_fixedUrl, options) => new WebSocket(`ws://127.0.0.1:${server.address().port}`, options) });
  assert.equal(headers['x-api-key'], c.apiKey); assert.equal(headers['x-api-request-id'], 'local-ws-fixture');
  assert.equal(headers['x-api-resource-id'], c.resourceId); assert.equal(response.payload.result.text, '看一看。');
  assert.deepEqual(Buffer.concat(received.slice(1).map(p => p.bytes)), audio.streamBytes);
});

test('ASR actual handshake rejects redirects without sending credentials to another origin', async (t) => {
  const { audio } = await audioFixture(t); const c = await config(); let calls = 0;
  const server = createServer((_req, res) => { calls++; res.writeHead(302, { Location: 'http://127.0.0.1:1/never' }); res.end(c.apiKey); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(recognizeVolcengine(c, audio, { requestId: 'local-redirect-fixture',
    webSocketFactory: (_fixedUrl, options) => new WebSocket(`ws://127.0.0.1:${server.address().port}`, options) }),
  e => e.code === 'ASR_HTTP' && e.message.includes('302') && !e.message.includes(c.apiKey));
  assert.equal(calls, 1);
});
