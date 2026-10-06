import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FACTORY = fileURLToPath(new URL('../', import.meta.url));
export const WORKSPACE = path.resolve(process.env.STORYBOOK_WORKSPACE || process.cwd());
export const VERSIONS = { hyperframes: '0.8.118', gsap: '3.14.2' };
export const hash = (data) => createHash('sha256').update(data).digest('hex');

export function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function localPath(base, value) {
  if (typeof value !== 'string' || !value || /[?#\\]/.test(value) || /^[a-z]+:/i.test(value)) {
    fail('INVALID_LOCAL_PATH', `必须使用本地相对路径: ${value}`);
  }
  const result = path.resolve(base, value);
  const relative = path.relative(base, result);
  if (path.isAbsolute(value) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('PATH_ESCAPE', `路径越出项目: ${value}`);
  }
  return result;
}

export function validateJob(input) {
  if (input?.schema_version !== '0.1') fail('INVALID_JOB', 'schema_version 必须为 0.1');
  for (const key of ['id', 'artifact_version']) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(input[key] ?? '')) fail('INVALID_JOB', `${key} 必须是有效 slug`);
  }
  if (!['technical_validation', 'exploration'].includes(input.purpose)) {
    fail('UNSUPPORTED_PURPOSE', '当前入口只接技术验证或明确授权的探索，不自动执行正式单集');
  }
  const { width, height, fps, duration_seconds } = input.target ?? {};
  if (![width, height].every((n) => Number.isInteger(n) && n >= 32 && n <= 4096)
      || ![24, 30, 60].includes(fps) || !Number.isFinite(duration_seconds) || duration_seconds <= 0
      || !Number.isInteger(duration_seconds * fps)) fail('INVALID_TARGET', '画布、fps、正时长及整数帧数不合法');
  if (typeof input.project !== 'string' || !Array.isArray(input.assets)
      || !input.assets.every((value) => typeof value === 'string') || new Set(input.assets).size !== input.assets.length) {
    fail('INVALID_JOB', '必须提供 project 与不重复的本地 assets 列表');
  }
  if (typeof input.expect_audio !== 'boolean') fail('INVALID_JOB', 'expect_audio 必须显式指定');
  return input;
}

export async function assertContained(base, file) {
  const actual = await realpath(file);
  const relative = path.relative(base, actual);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('SYMLINK_ESCAPE', `源文件越出项目: ${file}`);
  return actual;
}

export async function prepareJob(jobFile) {
  const jobPath = await realpath(jobFile);
  const raw = await readFile(jobPath);
  const job = validateJob(JSON.parse(raw));
  const base = path.dirname(jobPath);
  const project = await assertContained(base, localPath(base, job.project));
  for (const [name, version] of Object.entries(VERSIONS)) {
    const installed = JSON.parse(await readFile(path.join(FACTORY, 'node_modules', name, 'package.json'), 'utf8'));
    if (installed.version !== version) fail('VERSION_MISMATCH', `${name} 运行版本不匹配`);
  }
  const gsap = await readFile(path.join(FACTORY, 'node_modules/gsap/dist/gsap.min.js'));
  const vendorDir = path.join(project, 'vendor');
  await mkdir(vendorDir, { recursive: true });
  await assertContained(project, vendorDir);
  const vendorFile = path.join(vendorDir, 'gsap.min.js');
  try { await writeFile(vendorFile, gsap, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    await assertContained(project, vendorFile);
    if (hash(await readFile(vendorFile)) !== hash(gsap)) fail('VENDOR_CONFLICT', '已有 GSAP 文件与锁定依赖不同，拒绝覆盖');
  }
  const names = ['index.html', ...job.assets];
  if (!names.includes('vendor/gsap.min.js')) fail('MISSING_VENDOR', 'assets 必须显式包含 vendor/gsap.min.js');
  const sources = [{ path: path.basename(jobPath), sha256: hash(raw) }];
  const sourceTexts = [];
  for (const name of names) {
    const file = await assertContained(project, localPath(project, name));
    const data = await readFile(file);
    sources.push({ path: name, sha256: hash(data) });
    if (/\.(html|css)$/.test(name)) sourceTexts.push({ text: data.toString('utf8'), name });
  }
  // Fail before a browser request when authored HTML/CSS references remote or undeclared assets.
  for (const { text, name } of sourceTexts) {
    const refs = [...text.matchAll(/(?:src|href|data-composition-src)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)];
    for (const match of refs) {
      const ref = match[1] ?? match[2];
      if (ref.startsWith('#') || ref.startsWith('data:')) continue;
      if (/^[a-z]+:/i.test(ref) || path.isAbsolute(ref)) fail('REMOTE_ASSET', `必须使用本地相对资产: ${ref}`);
      const resolved = localPath(project, path.join(path.dirname(name), ref));
      const relative = path.relative(project, resolved).split(path.sep).join('/');
      if (!names.includes(relative)) fail('UNDECLARED_ASSET', `未声明资产: ${ref}`);
    }
  }
  const html = await readFile(path.join(project, 'index.html'), 'utf8');
  const root = html.match(/<[^>]+\bdata-composition-id\s*=\s*["'][^"']+["'][^>]*>/i)?.[0];
  if (!root) fail('MISSING_COMPOSITION', 'index.html 缺少 composition root');
  for (const [attribute, expected] of [['data-width', job.target.width], ['data-height', job.target.height], ['data-duration', job.target.duration_seconds]]) {
    const value = root.match(new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
    if (Number(value) !== expected) fail('TARGET_MISMATCH', `${attribute} 与 job target 不一致`);
  }
  return { job, jobPath, project, sources };
}

export function verifyMedia(probe, target, expectAudio) {
  const videos = probe.streams.filter((s) => s.codec_type === 'video');
  const audio = probe.streams.filter((s) => s.codec_type === 'audio');
  const video = videos[0];
  const rate = video?.avg_frame_rate?.split('/').map(Number);
  const fps = rate?.[0] / rate?.[1];
  if (videos.length !== 1 || video.width !== target.width || video.height !== target.height
      || fps !== target.fps || Number(video.nb_read_frames) !== target.duration_seconds * target.fps
      || Math.abs(Number(probe.format.duration) - target.duration_seconds) > 1 / target.fps
      || video.codec_name !== 'h264' || Boolean(audio.length) !== expectAudio) {
    fail('MEDIA_MISMATCH', '实际编码、画布、fps、帧数、时长或音轨与 job 不一致');
  }
  return { width: video.width, height: video.height, fps, frames: Number(video.nb_read_frames),
    duration_seconds: Number(probe.format.duration), codec: video.codec_name, pixel_format: video.pix_fmt, audio_streams: audio.length };
}
