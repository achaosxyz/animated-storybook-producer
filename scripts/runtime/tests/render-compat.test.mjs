import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibleFFmpegArgs } from '../scripts/ffmpeg-compat.mjs';
import { installCaptureCompatibility } from '../src/capture-compat.mjs';
import { runtimeEnv } from '../src/runtime.mjs';

const filter = 'scale=in_color_matrix=bt601:in_range=pc:flags=neighbor,format=gbrp,scale=out_color_matrix=bt709:out_range=tv:flags=neighbor';
test('SDR fix preserves size/matrix/range and only changes exact filter arguments', () => {
  const args = ['-i', filter, '-vf', filter, '-pix_fmt', 'yuv420p', 'video.mp4'];
  const result = compatibleFFmpegArgs(args);
  assert.equal(result[1], filter);
  assert.equal(result[3], filter.replaceAll('flags=neighbor', 'flags=neighbor+accurate_rnd'));
  assert.deepEqual(compatibleFFmpegArgs(result), result);
  assert.deepEqual(result.slice(4), args.slice(4));
  assert.deepEqual(compatibleFFmpegArgs(['-vf', 'scale=1920:1080:flags=neighbor']), ['-vf', 'scale=1920:1080:flags=neighbor']);
  assert.deepEqual(compatibleFFmpegArgs(['-vf', filter + '+bitexact']),
    ['-vf', filter.replace('flags=neighbor,', 'flags=neighbor+accurate_rnd,') + '+bitexact']);
});
test('compat env wraps a custom binary without recursively wrapping itself', () => {
  if (process.platform !== 'linux' || process.arch !== 'x64') return;
  const env = runtimeEnv({ HYPERFRAMES_FFMPEG_PATH: '/custom/ffmpeg' });
  assert.equal(env.FACTORY_FFMPEG_BINARY, '/custom/ffmpeg');
  assert.deepEqual(runtimeEnv(env), env);
});
test('full-frame capture binds metrics on the screenshot session before capture', async () => {
  const calls = [];
  class Session { async send(method, params) { calls.push([this, method, params]); return { data: 'pixels' }; } }
  installCaptureCompatibility(Session);
  const session = new Session(), other = new Session();
  const request = { format: 'jpeg', fromSurface: true, captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 } };
  assert.deepEqual(await session.send('Page.captureScreenshot', request), { data: 'pixels' });
  await session.send('Page.captureScreenshot', request);
  await other.send('Page.captureScreenshot', request);
  assert.deepEqual(calls.map(([, method]) => method), ['Emulation.setDeviceMetricsOverride', 'Page.captureScreenshot',
    'Page.captureScreenshot', 'Emulation.setDeviceMetricsOverride', 'Page.captureScreenshot']);
  assert.strictEqual(calls[0][0], session);
  assert.deepEqual(calls[0][2], { mobile: false, width: 1080, height: 1920, deviceScaleFactor: 1 });
  assert.strictEqual(calls[1][2], request);
  await session.send('Page.captureScreenshot', { ...request, clip: { ...request.clip, height: 1080 } });
  assert.equal(calls.at(-2)[2].height, 1080);
});
test('small probes/crops/supersampling/other commands pass through untouched', async () => {
  const calls = [];
  class Session { async send(method, params) { calls.push([method, params]); } }
  installCaptureCompatibility(Session);
  const session = new Session();
  for (const clip of [{ x: 0, y: 0, width: 1, height: 1, scale: 1 },
    { x: 0, y: 0, width: 1080, height: 1920, scale: 2 }, { x: 20, y: 0, width: 100, height: 100, scale: 1 }]) {
    await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
  }
  await session.send('Page.getLayoutMetrics');
  assert.equal(calls.length, 4);
});
test('failed metrics binding blocks capture rather than shipping a partial frame', async () => {
  class Session { async send(method) { if (method === 'Emulation.setDeviceMetricsOverride') throw new Error('metrics failed'); throw new Error('must not capture'); } }
  installCaptureCompatibility(Session);
  await assert.rejects(new Session().send('Page.captureScreenshot', { format: 'png', fromSurface: true,
    clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 } }), /metrics failed/);
});
