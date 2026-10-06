#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// HyperFrames 0.8.118 SDR conversions reproduce a right-edge defect with
// local FFmpeg 8.0.1 swscale SIMD. Keep dimensions/matrices/ranges unchanged.
const conversions = [
  'scale=in_color_matrix=bt601:in_range=pc:flags=neighbor',
  'scale=out_color_matrix=bt709:out_range=tv:flags=neighbor',
];

export function compatibleFFmpegArgs(args) {
  return args.map((arg, index) => {
    if (!['-vf', '-filter:v', '-filter_complex'].includes(args[index - 1])) return arg;
    for (const conversion of conversions) {
      arg = arg.replaceAll(new RegExp(`${conversion}(?=,|;|\\[|$)`, 'g'), `${conversion}+accurate_rnd`);
    }
    return arg;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const original = process.argv.slice(2);
  const args = compatibleFFmpegArgs(original);
  if (args.some((arg, index) => arg !== original[index])) {
    console.error('[factory:ffmpeg] SDR swscale accurate_rnd compatibility enabled');
  }
  const binary = process.env.FACTORY_FFMPEG_BINARY || 'ffmpeg';
  if (path.resolve(binary) === fileURLToPath(import.meta.url)) throw new Error('FFmpeg wrapper recursion');
  const child = spawn(binary, args, { stdio: 'inherit', shell: false });
  const terminate = () => child.kill('SIGTERM');
  const interrupt = () => child.kill('SIGINT');
  process.on('SIGTERM', terminate); process.on('SIGINT', interrupt);
  child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.once('close', (code, signal) => {
    process.off('SIGTERM', terminate); process.off('SIGINT', interrupt);
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}
