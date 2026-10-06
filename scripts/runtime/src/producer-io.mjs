import { readFile, realpath, mkdir, stat, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SKILL_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
import { hash, fail } from './job.mjs';
export { hash, fail };
export const json = async f => JSON.parse(await readFile(f, 'utf8'));
export const save = (f, data) => writeFile(f, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
export function within(root, target) {
  const r = path.relative(root, target);
  if (r === '..' || r.startsWith(`..${path.sep}`) || path.isAbsolute(r)) fail('PATH_ESCAPE', 'Path leaves the selected workspace');
  return target;
}
export async function input(root, file) { return within(root, await realpath(file)); }
function outsideSkill(file) {
  const relative = path.relative(SKILL_ROOT,file);
  if(!relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative))) fail('OUTPUT_IN_SKILL','Outputs must remain outside the installed skill');
  return file;
}
export async function output(root, file) {
  file = outsideSkill(within(root, path.resolve(file)));
  let parent = path.dirname(file), missing = [];
  while (true) {
    try { parent = await realpath(parent); break; }
    catch (e) { if (e.code !== 'ENOENT') throw e; missing.unshift(path.basename(parent)); parent = path.dirname(parent); }
  }
  within(root, parent);
  try { await lstat(file); fail('OUTPUT_EXISTS', 'Output must be a new directory'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return outsideSkill(within(root, path.join(parent, ...missing, path.basename(file))));
}
export async function newDir(root, file) { const out = await output(root, file); await mkdir(path.dirname(out), { recursive: true }); await mkdir(out); return out; }
export async function bound(root, base, entry) {
  if (!entry || typeof entry.path !== 'string' || path.isAbsolute(entry.path) || /[?#\\]/.test(entry.path) || /^[a-z]+:/i.test(entry.path)) fail('INVALID_ASSET', 'Expected a relative file path and SHA-256');
  const file = await input(root, path.resolve(base, entry.path));
  if (!(await stat(file)).isFile()) fail('INVALID_ASSET', 'Input must be a regular file');
  const bytes = await readFile(file), digest = hash(bytes);
  if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || digest !== entry.sha256) fail('SOURCE_CHANGED', 'Input hash does not match');
  return { file, bytes, sha256: digest };
}
export const escapeHtml = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function finite(n, low = 0, high = Infinity) { if (!Number.isFinite(n) || n < low || n > high) fail('INVALID_NUMBER', 'Numeric value is outside the supported range'); return n; }
export async function runVideo(root, run) {
  run = await input(root, run);
  const manifest = await json(path.join(run, 'manifest.json'));
  if (manifest.status !== 'completed' || !manifest.output) fail('INCOMPLETE_RUN', 'A completed media run is required');
  const media = await bound(root, run, manifest.output);
  return { run, manifest, ...media };
}
