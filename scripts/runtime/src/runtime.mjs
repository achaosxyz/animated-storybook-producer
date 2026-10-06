import { spawn } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { FACTORY, fail } from './job.mjs';

export function runtimeEnv(base = process.env) {
  const wrapper = path.join(FACTORY, 'scripts/ffmpeg-compat.mjs');
  const compat = process.platform === 'linux' && process.arch === 'x64' ? {
    HYPERFRAMES_FFMPEG_PATH: wrapper,
    FACTORY_FFMPEG_BINARY: base.HYPERFRAMES_FFMPEG_PATH && base.HYPERFRAMES_FFMPEG_PATH !== wrapper
      ? base.HYPERFRAMES_FFMPEG_PATH : base.FACTORY_FFMPEG_BINARY || 'ffmpeg',
  } : {};
  return { ...base, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1',
    PRODUCER_HEADLESS_SHELL_PATH: base.HYPERFRAMES_BROWSER ?? '/usr/bin/google-chrome',
    NO_COLOR: '1', FORCE_COLOR: '0', ...compat };
}

export const cli = path.join(FACTORY, 'node_modules/hyperframes/bin/hyperframes.mjs');

export async function assertRuntime() {
  await access(cli);
  await access(runtimeEnv().PRODUCER_HEADLESS_SHELL_PATH, constants.X_OK);
}

export async function runCommand(command, args, { cwd, log, timeout = 180_000, inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: runtimeEnv(), shell: false,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', expired = false;
    const timer = setTimeout(() => { expired = true; child.kill('SIGTERM'); }, timeout);
    const interrupt = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    child.stdout?.on('data', (data) => { stdout += data; });
    child.stderr?.on('data', (data) => { stderr += data; });
    const cleanup = () => { clearTimeout(timer); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); };
    child.once('error', (error) => { cleanup(); reject(error); });
    child.once('close', async (code, signal) => {
      cleanup();
      try {
        if (log) await writeFile(log, `${stdout}\n${stderr}`);
        if (code !== 0 || expired) fail(expired ? 'STEP_TIMEOUT' : 'STEP_FAILED', `${path.basename(command)} ${args[0]} 失败 (${code ?? signal}); ${stderr.slice(-1200)}`);
        resolve({ stdout, stderr, exit_code: code });
      } catch (error) { reject(error); }
    });
  });
}

export const runHyperframes = (args, options) => runCommand(process.execPath,
  [...(args[0] === 'render' && process.platform === 'linux' && process.arch === 'x64'
    ? ['--import', path.join(FACTORY, 'scripts/render-compat.mjs')] : []), cli, ...args], options);

export function assertCheck(report) {
  if (report.ok !== true || report.browserSkipped !== false || !Array.isArray(report.layout?.samples) || !report.layout.samples.length) {
    fail('CHECK_NOT_RUN', 'HyperFrames 检查失败、浏览器未执行或没有实际采样');
  }
  return report;
}

// Verification owns this foreground service and closes it; never use detached/background servers.
export async function startPreview(project, log) {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, [cli, 'preview', project, '--foreground', '--no-open', '--port', String(port), '--no-browser-gpu'],
    { cwd: project, env: runtimeEnv(), stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let output = '', launchError;
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  child.on('error', (error) => { launchError = error; });
  const closed = new Promise((resolve) => child.once('close', resolve));
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const close = async () => {
    stop(); await closed;
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    if (log) await writeFile(log, output);
  };
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) fail('PREVIEW_EXITED', output.slice(-1200));
      try {
        const result = await fetch(base, { signal: AbortSignal.timeout(500) });
        if (result.ok) return { url: `${base}/#project/${encodeURIComponent(path.basename(project))}`, close };
      } catch { /* wait for the owned local service to become ready */ }
      await delay(500);
    }
    fail('PREVIEW_TIMEOUT', 'HyperFrames 本地预览未在 30 秒内就绪');
  } catch (error) { await close(); throw error; }
}
