import { readFile } from 'node:fs/promises';
import { CdpCDPSession } from 'puppeteer-core';
import { installCaptureCompatibility } from '../src/capture-compat.mjs';

for (const [name, version] of [['hyperframes', '0.8.118'], ['puppeteer-core', '25.10.0']]) {
  const installed = JSON.parse(await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url)));
  if (installed.version !== version) throw new Error(`RENDER_COMPAT_VERSION_MISMATCH: ${name}`);
}
installCaptureCompatibility(CdpCDPSession, (message) => console.error(message));
