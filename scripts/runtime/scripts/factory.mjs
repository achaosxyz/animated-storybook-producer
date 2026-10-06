import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FACTORY, WORKSPACE, VERSIONS, prepareJob, verifyMedia, hash, fail } from '../src/job.mjs';
import { assertRuntime, assertCheck, runHyperframes, runCommand, runtimeEnv } from '../src/runtime.mjs';

export function parseArgs(args) {
  const action = args.shift();
  if (!['check', 'preview', 'render'].includes(action)) fail('INVALID_ACTION', '使用 check、preview 或 render');
  const options = {};
  while (args.length) {
    const flag = args.shift();
    if (!['--job', '--out', '--port', '--quality'].includes(flag) || !args.length || options[flag.slice(2)] !== undefined) {
      fail('INVALID_ARGUMENT', `未知、重复或缺少值的参数: ${flag}`);
    }
    options[flag.slice(2)] = args.shift();
  }
  options.job = path.resolve(options.job ?? path.join(FACTORY, 'examples/backend-smoke/job.json'));
  options.port = Number(options.port ?? 4318);
  options.quality ??= 'draft';
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) fail('INVALID_PORT', 'port 必须为 1024～65535');
  if (!['draft', 'looks', 'delivery'].includes(options.quality)) fail('INVALID_QUALITY', 'quality 必须为 draft、looks 或 delivery');
  return { action, options };
}

export function outputPath(options, prepared, runId) {
  if (options.out !== undefined) return path.resolve(options.out);
  const run = `${prepared.job.artifact_version}-${runId.slice(0, 8)}`;
  if (prepared.job.purpose === 'technical_validation') {
    return path.join(WORKSPACE, '.mar', 'technical-runs', prepared.job.id, run);
  }
  const relative = path.relative(path.join(WORKSPACE, 'episodes'), prepared.jobPath);
  const episode = relative.split(path.sep)[0];
  if (!path.isAbsolute(relative) && /^(?!000-)[0-9]{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(episode)) {
    return path.join(WORKSPACE, 'episodes', episode, 'renders', run);
  }
  fail('OUTPUT_REQUIRED', '探索工程不在编号剧集内，请显式指定 --out；不按 job.id 自动新建剧集');
}

export async function main(args) {
  const { action, options } = parseArgs(args);
  const prepared = await prepareJob(options.job);
  const { job, project, sources } = prepared;
  await assertRuntime();
  if (action === 'preview') {
    console.log(`技术预览（不代表作品批准），project=${project}，port=${options.port}`);
    await runHyperframes(['preview', project, '--foreground', '--no-open', '--port', String(options.port), '--no-browser-gpu'],
      { cwd: project, inherit: true, timeout: 3_600_000 });
    return;
  }
  const runId = randomUUID();
  const out = outputPath(options, prepared, runId);
  // Never put generated output into an input project, nor reuse an existing directory.
  const relativeOut = path.relative(project, out);
  if (!relativeOut || (!relativeOut.startsWith(`..${path.sep}`) && relativeOut !== '..' && !path.isAbsolute(relativeOut))) {
    fail('OUTPUT_IN_SOURCE', '输出目录不得位于 composition 源目录内');
  }
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(out);
  const manifestFile = path.join(out, 'manifest.json');
  const manifest = {
    schema_version: '0.1', run_id: runId, id: job.id, artifact_version: job.artifact_version,
    purpose: job.purpose, command: action, target: job.target, expect_audio: job.expect_audio, sources,
    runtime: { ...VERSIONS, node: process.version, browser: runtimeEnv().PRODUCER_HEADLESS_SHELL_PATH, telemetry: false,
      ...(action === 'render' && process.platform === 'linux' && process.arch === 'x64' ? {
        render_compat: { id: 'hf-0.8.118-cdp1x-swscale-v1', ffmpeg_binary: runtimeEnv().FACTORY_FFMPEG_BINARY,
          sources: await Promise.all(['src/runtime.mjs', 'src/capture-compat.mjs', 'scripts/render-compat.mjs', 'scripts/ffmpeg-compat.mjs']
            .map(async (file) => ({ path: file, sha256: hash(await readFile(path.join(FACTORY, file))) }))) },
      } : {}),
    },
    started_at: new Date().toISOString(), status: 'running', steps: [],
    checks: { technical: { status: 'pending' }, pose_visual: { status: job.purpose === 'technical_validation' ? 'not_applicable' : 'pending' } },
    canonical_version: null, gate_c: null,
  };
  const save = () => writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  await save();
  try {
    const result = await runHyperframes(['check', project, '--json', '--samples', '7', '--timeout', '30000', '--no-browser-gpu'],
      { cwd: project, log: path.join(out, 'check.log') });
    const report = assertCheck(JSON.parse(result.stdout));
    await writeFile(path.join(out, 'check.json'), JSON.stringify(report, null, 2) + '\n');
    manifest.steps.push({ name: 'check', status: 'passed', exit_code: result.exit_code });
    await save();
    if (action === 'render') {
      const video = path.join(out, 'output.mp4');
      const args = ['render', project, '--output', video, '--fps', String(job.target.fps), '--quality', options.quality,
        '--workers', '1', '--strict', '--no-best-effort', '--no-browser-gpu'];
      const render = await runHyperframes(args, { cwd: project, log: path.join(out, 'render.log'), timeout: 900_000 });
      manifest.steps.push({ name: 'render', status: 'passed', exit_code: render.exit_code });
      const probe = await runCommand('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', video],
        { log: path.join(out, 'ffprobe.log') });
      const metadata = JSON.parse(probe.stdout);
      await writeFile(path.join(out, 'ffprobe.json'), JSON.stringify(metadata, null, 2) + '\n');
      manifest.output = { path: 'output.mp4', sha256: hash(await readFile(video)), media: verifyMedia(metadata, job.target, job.expect_audio) };
      manifest.steps.push({ name: 'media-spec', status: 'passed', exit_code: probe.exit_code });
    }
    const current = await prepareJob(options.job);
    if (JSON.stringify(current.sources) !== JSON.stringify(sources)) fail('SOURCE_CHANGED', '运行期间源文件发生变化，当前证据失效');
    manifest.checks.technical.status = 'passed';
    manifest.status = 'completed';
    manifest.finished_at = new Date().toISOString();
    await save();
    console.log(JSON.stringify({ status: manifest.status, purpose: job.purpose, out, output: manifest.output ?? null }));
  } catch (error) {
    manifest.status = 'failed';
    manifest.checks.technical.status = 'failed';
    manifest.error = { code: error.code ?? 'ERROR', message: error.message };
    manifest.finished_at = new Date().toISOString();
    await save();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(`${error.code ?? 'ERROR'}: ${error.message}`); process.exitCode = 1; });
}
