// Screenshot capture uses a separate CDP session from Puppeteer's viewport
// emulation. Bind full-frame 1x metrics to that same session before capture;
// otherwise local Chrome resets to its 1833px native viewport during capture.
export function installCaptureCompatibility(Session, log = () => {}) {
  const send = Session.prototype.send;
  const bound = new WeakMap();
  Session.prototype.send = async function (method, ...args) {
    const request = args[0], clip = request?.clip;
    if (method === 'Page.captureScreenshot' && request.fromSurface === true
        && ['png', 'jpeg'].includes(request.format) && clip?.x === 0 && clip?.y === 0 && clip?.scale === 1
        && Number.isInteger(clip.width) && clip.width > 1 && Number.isInteger(clip.height) && clip.height > 1) {
      const key = `${clip.width}x${clip.height}`;
      if (bound.get(this) !== key) {
        await send.call(this, 'Emulation.setDeviceMetricsOverride', {
          mobile: false, width: clip.width, height: clip.height, deviceScaleFactor: 1,
        });
        bound.set(this, key);
        log(`[factory:capture] screenshot-session viewport ${key} @1x`);
      }
    }
    return send.call(this, method, ...args);
  };
}
