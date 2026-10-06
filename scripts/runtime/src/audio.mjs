import { fail } from './job.mjs';

export function pcmWave(pcm, sampleRate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function readPcmWave(bytes, sampleRate = 24000) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') fail('INVALID_AUDIO', '音频不是可读 WAV');
  let format, pcm;
  for (let p = 12; p + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', p, p + 4), size = bytes.readUInt32LE(p + 4), start = p + 8;
    if (start + size > bytes.length) fail('INVALID_AUDIO', 'WAV 数据不完整');
    if (kind === 'fmt ') {
      if (size < 16) fail('INVALID_AUDIO', 'WAV 格式块无效');
      format = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), rate: bytes.readUInt32LE(start + 4), bits: bytes.readUInt16LE(start + 14) };
    }
    if (kind === 'data') pcm = bytes.subarray(start, start + size);
    p = start + size + (size % 2);
  }
  if (!format || format.encoding !== 1 || format.channels !== 1 || format.rate !== sampleRate || format.bits !== 16 || !pcm?.length || pcm.length % 2) fail('INVALID_AUDIO', '需要完整单声道 16-bit PCM WAV');
  return { pcm, durationMs: pcm.length / (sampleRate * 2) * 1000 };
}
