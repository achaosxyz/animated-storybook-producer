import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WORKSPACE, validateJob, localPath, prepareJob, verifyMedia } from '../src/job.mjs';
import { runtimeEnv, assertCheck, runCommand } from '../src/runtime.mjs';
import { parseArgs, outputPath } from '../scripts/factory.mjs';
import { parseVerifyArgs, assertSources, sampleFrames } from '../scripts/verify.mjs';

const job = () => ({ schema_version: '0.1', id: 'smoke', artifact_version: 'smoke-v1', purpose: 'technical_validation',
  project: '.', target: { width: 1080, height: 1920, fps: 30, duration_seconds: 4 },
  assets: ['vendor/gsap.min.js'], expect_audio: false });
const html = (extra = '') => `<html><head><script src="vendor/gsap.min.js"></script>${extra}</head><body><div data-composition-id="main" data-width="1080" data-height="1920" data-duration="4"></div></body></html>`;

test('target requires positive duration, supported fps and integral frames', () => {
  assert.equal(validateJob(job()).purpose, 'technical_validation');
  for (const value of [0, -1, 0.01, Infinity]) {
    const input = job(); input.target.duration_seconds = value;
    assert.throws(() => validateJob(input), { code: 'INVALID_TARGET' });
  }
});
test('formal production and duplicate assets cannot silently pass', () => {
  assert.throws(() => validateJob({ ...job(), purpose: 'production' }), { code: 'UNSUPPORTED_PURPOSE' });
  assert.throws(() => validateJob({ ...job(), assets: ['x', 'x'] }), { code: 'INVALID_JOB' });
});
test('local assets reject escapes, remote URLs and query/input paths', () => {
  for (const value of ['../secret', '/tmp/secret', 'https://example.org/a', 'a?key=x', 'a\\b']) assert.throws(() => localPath('/tmp/project', value));
  assert.equal(localPath('/tmp/project', '..named.png'), '/tmp/project/..named.png');
});
test('runtime privacy overrides inherited opt-in values', () => {
  const env = runtimeEnv({ HYPERFRAMES_NO_TELEMETRY: '0', DO_NOT_TRACK: '0', HYPERFRAMES_BROWSER: '/custom/chrome' });
  assert.equal(env.HYPERFRAMES_NO_TELEMETRY, '1'); assert.equal(env.DO_NOT_TRACK, '1');
  assert.equal(env.PRODUCER_HEADLESS_SHELL_PATH, '/custom/chrome');
});
test('browser skipped or empty audits are not a pass', () => {
  for (const value of [{ ok: true, browserSkipped: true }, { ok: true, browserSkipped: false, layout: { samples: [] } }, { ok: false }]) assert.throws(() => assertCheck(value), { code: 'CHECK_NOT_RUN' });
  assertCheck({ ok: true, browserSkipped: false, layout: { samples: [0] } });
});
test('media verification checks decoded frames, exact spec and audio', () => {
  const probe = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, avg_frame_rate: '30/1', nb_read_frames: '120', pix_fmt: 'yuv420p' }], format: { duration: '4' } };
  assert.equal(verifyMedia(probe, job().target, false).frames, 120);
  for (const field of ['width', 'height', 'nb_read_frames', 'avg_frame_rate']) {
    const copy = structuredClone(probe); copy.streams[0][field] = '1';
    assert.throws(() => verifyMedia(copy, job().target, false), { code: 'MEDIA_MISMATCH' });
  }
  probe.streams.push({ codec_type: 'audio' });
  assert.throws(() => verifyMedia(probe, job().target, false), { code: 'MEDIA_MISMATCH' });
});
test('CLI rejects unknown, duplicated and invalid flags', () => {
  assert.equal(parseArgs(['render']).options.quality, 'draft');
  for (const args of [['cloud'], ['render', '--overwrite'], ['render', '--quality', 'latest'], ['check', '--port', '0'], ['check', '--job', 'a', '--job', 'b']]) assert.throws(() => parseArgs(args));
});
test('technical runs do not create unnumbered episode directories', () => {
  const prepared = { job: job(), jobPath: path.join(WORKSPACE, 'factory/examples/smoke/job.json') };
  assert.equal(outputPath({}, prepared, '12345678-other'), path.join(WORKSPACE, '.mar/technical-runs/smoke/smoke-v1-12345678'));
});
test('exploration output follows the numbered episode, not the historical job id', () => {
  const prepared = { job: { ...job(), purpose: 'exploration', id: 'old-working-id' },
    jobPath: path.join(WORKSPACE, 'episodes/001-story/source-v1/job.json') };
  assert.equal(outputPath({}, prepared, '12345678-other'), path.join(WORKSPACE, 'episodes/001-story/renders/smoke-v1-12345678'));
});
test('unassigned exploration requires an explicit output without inventing an episode', () => {
  const prepared = { job: { ...job(), purpose: 'exploration' }, jobPath: path.join(WORKSPACE, 'episodes/legacy-story/job.json') };
  assert.throws(() => outputPath({}, prepared, '12345678-other'), { code: 'OUTPUT_REQUIRED' });
  prepared.jobPath = path.join(WORKSPACE, 'episodes/000-story/job.json');
  assert.throws(() => outputPath({}, prepared, '12345678-other'), { code: 'OUTPUT_REQUIRED' });
  assert.equal(outputPath({ out: 'explicit-output' }, prepared, '12345678-other'), path.resolve('explicit-output'));
});
test('failed child commands exit instead of being treated as completed', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(7)']), { code: 'STEP_FAILED' });
});
test('verification retries use a new named QA directory, not overwrite or escaped paths', () => {
  const args = ['--job', 'job.json', '--run', 'run'];
  assert.equal(parseVerifyArgs(args)['qa-name'], 'qa');
  assert.equal(parseVerifyArgs([...args, '--qa-name', 'qa-retry-01'])['qa-name'], 'qa-retry-01');
  for (const value of ['../outside', '/tmp/qa', '', 'qa/retry']) assert.throws(() => parseVerifyArgs([...args, '--qa-name', value]));
  assert.throws(() => parseVerifyArgs([...args, '--overwrite']));
});
test('source changes during Studio verification invalidate the run', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'storybook-verify-'));
  try {
    await writeFile(path.join(dir, 'job.json'), JSON.stringify(job()));
    await writeFile(path.join(dir, 'index.html'), html());
    const prepared = await prepareJob(path.join(dir, 'job.json'));
    await assertSources(prepared.jobPath, prepared.sources);
    await writeFile(path.join(dir, 'index.html'), html('<!-- Studio source mutation -->'));
    await assert.rejects(assertSources(prepared.jobPath, prepared.sources), { code: 'STALE_RUN' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('sample frames stay inside short clips and retain transition/ending samples', () => {
  for (const count of [1, 2, 3, 7, 8, 120]) {
    const frames = sampleFrames(count);
    assert.equal(new Set(frames).size, frames.length);
    assert.ok(frames.every((frame) => Number.isInteger(frame) && frame >= 0 && frame < count));
    assert.ok(frames.includes(0)); assert.ok(frames.includes(count - 1));
  }
  assert.deepEqual(sampleFrames(120), [0, 15, 30, 59, 60, 90, 118, 119]);
});
test('preflight registers local vendor, hashes real assets and resolves nested CSS', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'storybook-factory-'));
  try {
    const input = job(); input.assets.push('styles/main.css', 'assets/scene.png');
    await mkdir(path.join(dir, 'styles')); await mkdir(path.join(dir, 'assets'));
    await writeFile(path.join(dir, 'styles/main.css'), '.scene { background-image: url(../assets/scene.png); }');
    await writeFile(path.join(dir, 'assets/scene.png'), 'test-only bytes');
    await writeFile(path.join(dir, 'index.html'), html('<link href="styles/main.css" rel="stylesheet">'));
    await writeFile(path.join(dir, 'job.json'), JSON.stringify(input));
    const prepared = await prepareJob(path.join(dir, 'job.json'));
    assert.equal(prepared.sources.length, 5);
    assert.match(prepared.sources[1].sha256, /^[a-f0-9]{64}$/);
    await writeFile(path.join(dir, 'vendor/gsap.min.js'), 'user-owned replacement');
    await assert.rejects(prepareJob(path.join(dir, 'job.json')), { code: 'VENDOR_CONFLICT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('preflight blocks undeclared, missing, remote and escaped linked assets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'storybook-factory-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'storybook-external-'));
  try {
    await writeFile(path.join(dir, 'job.json'), JSON.stringify(job()));
    await writeFile(path.join(dir, 'index.html'), html('<img src="absent.png">'));
    await assert.rejects(prepareJob(path.join(dir, 'job.json')), { code: 'UNDECLARED_ASSET' });
    await writeFile(path.join(dir, 'index.html'), html('<img src="https://example.org/scene.png">'));
    await assert.rejects(prepareJob(path.join(dir, 'job.json')), { code: 'REMOTE_ASSET' });
    await writeFile(path.join(outside, 'secret.png'), 'external-test-only');
    await symlink(path.join(outside, 'secret.png'), path.join(dir, 'linked.png'));
    await writeFile(path.join(dir, 'job.json'), JSON.stringify({ ...job(), assets: [...job().assets, 'linked.png'] }));
    await assert.rejects(prepareJob(path.join(dir, 'job.json')), { code: 'SYMLINK_ESCAPE' });
  } finally { await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
