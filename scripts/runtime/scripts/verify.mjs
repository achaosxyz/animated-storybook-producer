import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import puppeteer from 'puppeteer-core';
import { prepareJob, hash, fail } from '../src/job.mjs';
import { runtimeEnv, runCommand, startPreview } from '../src/runtime.mjs';

export function parseVerifyArgs(args) {
  const { values } = parseArgs({ args, options: { job: { type: 'string' }, run: { type: 'string' }, preview: { type: 'string' }, 'qa-name': { type: 'string', default: 'qa' } } });
  if (!values.job || !values.run) fail('INVALID_ARGUMENT', 'verify 需要 --job 和 --run；可选 --preview 指定已有本地预览');
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(values['qa-name'])) fail('INVALID_ARGUMENT', '--qa-name 必须是单个 slug，不覆盖已有证据');
  return values;
}

export async function assertSources(jobPath, expected) {
  const current = await prepareJob(jobPath);
  if (JSON.stringify(current.sources) !== JSON.stringify(expected)) fail('STALE_RUN', '预览或验证期间源文件已改变，需要对当前版本重新导出');
}

export function sampleFrames(count) {
  return [...new Set([0, Math.floor(count / 8), Math.floor(count / 4), Math.floor(count / 2) - 1,
    Math.floor(count / 2), Math.floor(3 * count / 4), count - 2, count - 1]
    .map((frame) => Math.max(0, Math.min(count - 1, frame))))];
}

export async function verify(args = process.argv.slice(2)) {
  const values = parseVerifyArgs(args);
  let preview;
  if (values.preview) {
    preview = new URL(values.preview);
    if (preview.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(preview.hostname)) fail('REMOTE_PREVIEW', '只验证本地 HyperFrames 预览');
  }
  const prepared = await prepareJob(path.resolve(values.job));
  const out = path.resolve(values.run);
  const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
  if (manifest.status !== 'completed' || manifest.id !== prepared.job.id
      || manifest.artifact_version !== prepared.job.artifact_version || !manifest.output
      || JSON.stringify(manifest.sources) !== JSON.stringify(prepared.sources)) fail('STALE_RUN', '运行未完成、身份/版本不匹配或源文件已改变');
  const video = await readFile(path.join(out, manifest.output.path));
  if (hash(video) !== manifest.output.sha256) fail('VIDEO_CHANGED', '视频与渲染记录不一致');
  const qa = path.join(out, values['qa-name']);
  await mkdir(qa);
  await mkdir(path.join(qa, 'seek'));
  await mkdir(path.join(qa, 'decoded'));
  const report = { purpose: 'technical_validation', status: 'running', sources: prepared.sources, video_sha256: hash(video),
    target: prepared.job.target, samples: [], visual_review: 'pending', canonical_version: null, gate_c: null };
  let browser, server, ownedPreview;
  const errors = [], blocked = [];
  try {
    if (!preview) { ownedPreview = await startPreview(prepared.project, path.join(qa, 'preview.log')); preview = new URL(ownedPreview.url); }
    report.preview_url = preview.href;
    browser = await puppeteer.launch({ executablePath: runtimeEnv().PRODUCER_HEADLESS_SHELL_PATH,
      headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    report.browser_version = await browser.version();
    const page = await browser.newPage();
    await page.setViewport({ width: prepared.job.target.width, height: prepared.job.target.height, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname)) {
        blocked.push(request.url()); void request.abort();
      } else { void request.continue(); }
    });
    // Studio keeps /api/events (SSE) open; networkidle0 is not a readiness signal.
    await page.goto(preview.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!preview.pathname.includes('/preview')) {
      // The player owns a shadow-DOM iframe. Observe browser frames, not a light-DOM selector.
      const frame = await page.waitForFrame((candidate) => {
        if (!URL.canParse(candidate.url())) return false;
        const url = new URL(candidate.url());
        return url.origin === preview.origin && url.pathname.startsWith('/api/projects/') && url.pathname.endsWith('/preview');
      }, { timeout: 30_000 });
      const frameUrl = frame.url();
      await page.goto(frameUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      report.composition_url = frameUrl;
    }
    // HyperFrames virtualizes page RAF/timers. Readiness is host-driven, not a page poller.
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      ready = await page.evaluate(() => window.__playerReady === true && typeof window.__player?.renderSeek === 'function'
        && Object.keys(window.__timelines ?? {}).length > 0
        && [...document.images].every((image) => image.complete && image.naturalWidth > 0));
      if (ready) break;
      await delay(500);
    }
    if (!ready) {
      report.readiness = await page.evaluate(() => ({ url: location.href, seek_type: typeof window.__player?.renderSeek,
        timelines: Object.keys(window.__timelines ?? {}), images: [...document.images].map((image) => ({ src: image.src, complete: image.complete, width: image.naturalWidth })) }));
      fail('PREVIEW_NOT_READY', '编译后页面的时间轴或图片未就绪');
    }
    await assertSources(prepared.jobPath, prepared.sources);
    const count = prepared.job.target.fps * prepared.job.target.duration_seconds;
    const frames = sampleFrames(count);
    const shuffle = [4, 0, 7, 2, 6, 1, 5, 3].filter((index) => index < frames.length).map((index) => frames[index]);
    const baselines = new Map();
    for (const [order, sequence] of [['forward', frames], ['reverse', [...frames].reverse()], ['shuffle', shuffle]]) {
      for (const frame of sequence) {
        await page.evaluate(async (time) => {
          await window.__player.renderSeek(time);
          await document.fonts.ready;
          const raf = (window.__HF_VIRTUAL_TIME__?.originalRequestAnimationFrame ?? window.requestAnimationFrame).bind(window);
          await new Promise((resolve) => raf(() => raf(resolve)));
        }, frame / prepared.job.target.fps);
        const file = `seek/${order}-${String(frame).padStart(4, '0')}.png`;
        const bytes = await page.screenshot({ path: path.join(qa, file), type: 'png' });
        const digest = hash(bytes);
        if (order === 'forward') baselines.set(frame, digest);
        else if (baselines.get(frame) !== digest) fail('SEEK_MISMATCH', `同页 ${order} f${frame} 像素截图与正序不同`);
        report.samples.push({ order, frame, path: file, sha256: digest });
      }
    }
    if (new Set(baselines.values()).size < 2) fail('STATIC_PREVIEW', '所有采样画面相同，不能证明时间轴实际运行');
    if (errors.length || blocked.length) fail('PREVIEW_ERROR', `页面错误或外部资产请求: ${JSON.stringify({ errors, blocked })}`);
    report.same_page_seek = { status: 'passed', requests: report.samples.length, independent_png_bytes_equal: true,
      method: '同一浏览器同一页面，以 HyperFrames __player.renderSeek 进行正序/逆序/固定乱序采样，不重载页面' };
    await runCommand('ffmpeg', ['-v', 'error', '-i', path.join(out, manifest.output.path), '-vf',
      `select=${frames.map((f) => `eq(n\\,${f})`).join('+')}`, '-fps_mode', 'vfr', path.join(qa, 'decoded/frame-%03d.png')],
      { log: path.join(qa, 'decode.log') });
    report.decoded_frames = frames;
    server = createServer((request, response) => {
      if (request.url !== '/output.mp4') { response.writeHead(404).end(); return; }
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1;
      if (start > end || start >= video.length) { response.writeHead(416).end(); return; }
      const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 };
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${video.length}`;
      response.writeHead(range ? 206 : 200, headers).end(video.subarray(start, end + 1));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const videoUrl = `http://127.0.0.1:${server.address().port}/output.mp4`;
    // A fresh page has real media clocks/timers, unlike the virtualized composition document.
    const playbackPage = await browser.newPage();
    await playbackPage.setContent(`<video id="video" muted preload="auto" src="${videoUrl}"></video>`);
    report.playback = await playbackPage.evaluate(async (duration) => {
      const video = document.querySelector('video');
      const ended = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('视频播放超时')), Math.max(15_000, duration * 1000 + 10_000));
        video.addEventListener('ended', () => { clearTimeout(timer); resolve(); }, { once: true });
        video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('视频解码失败')); }, { once: true });
      });
      await video.play(); await ended;
      const quality = video.getVideoPlaybackQuality();
      return { ended: video.ended, duration_seconds: video.duration, error: video.error?.code ?? null,
        width: video.videoWidth, height: video.videoHeight, total_video_frames: quality.totalVideoFrames, dropped_video_frames: quality.droppedVideoFrames };
    }, prepared.job.target.duration_seconds);
    if (!report.playback.ended || report.playback.error) fail('PLAYBACK_FAILED', '视频未完整播放');
    await assertSources(prepared.jobPath, prepared.sources);
    if (hash(await readFile(path.join(out, manifest.output.path))) !== manifest.output.sha256) fail('VIDEO_CHANGED', '验证期间视频已改变');
    report.status = 'passed';
    report.visual_review = 'pending-human-inspection';
  } catch (error) {
    report.status = 'failed'; report.error = { code: error.code ?? 'ERROR', message: error.message };
    throw error;
  } finally {
    report.page_errors = errors; report.blocked_requests = blocked;
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await ownedPreview?.close();
    await writeFile(path.join(qa, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ status: report.status, qa, same_page_seek: report.same_page_seek, playback: report.playback }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verify().catch((error) => { console.error(`${error.code ?? 'ERROR'}: ${error.message}`); process.exitCode = 1; });
}
