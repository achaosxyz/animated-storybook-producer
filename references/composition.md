# Deterministic composition and export

The locked runtime uses HyperFrames 0.8.118 and GSAP 3.14.2. HTML arranges accepted assets, SVG provides appropriate simple graphics, Canvas provides deterministic procedural details, GSAP controls composition motion, and HyperFrames owns media/time/export. Code is not a substitute for generated illustrated scenery or malformed character art.

## Build contract

Use the single public `scripts/producer.mjs` entry. Sprite build mode accepts complete PNG asset definitions and independent scene instances. Composition mode copies an explicitly hash-bound, locally authored HTML project into a new build; it is the extension path for richer timelines, custom SVG/Canvas, parameterized covers and caller-supplied outros. Neither mode calls image generation, creates missing anatomy, auto-composes stories or silently edits approved input.

A top-level `index.html` places its root directly in body, not inside a template. Root attributes specify composition ID, width, height, fps and duration; CSS root width/height are 100%. Register one paused GSAP timeline under exactly that ID after construction. Root duration, all clips and audio must agree with the final edit; extending a timeline alone does not extend a declared root.

Timed visual elements use `class="clip"`, explicit start/duration and track index. Track index is an editing lane; CSS z-index determines stacking. The framework owns clip visibility: never tween display/visibility/autoAlpha on a clip. Animate its child or use complete-pose timed exposures. Do not mix CSS transform initialization with GSAP motion on the same property; initialize in fromTo. Keep IDs unique across assembled content.

Sub-compositions use a template with required style/script inside it. Match host, child root and timeline identity unless a deliberate mapping is verified. Do not manually nest framework-owned child timelines. Never add video under another timed plain wrapper; audio/video have explicit IDs and local src, no crossorigin attribute. The framework controls seeking and audio playback.

No wall-clock-driven state, unseeded randomness, external network resources, CSS playback clocks or user-input dependence. Canvas rendering must derive from explicit timeline state, not accumulated previous frames. Provide local fonts via @font-face. Images, fonts and timelines must be ready before capture. SVG/Canvas are optional composition tools, not a mandate to redraw illustrated assets.

## Space

A sprite's pivot is measured in its native image coordinates. Scene placement is `left = root_x - pivot_x * scale`, `top = root_y - pivot_y * scale`; width/height use the same scale. Do not make per-pose bounding boxes fill a fixed rectangle. Group camera transformation follows scene registration. Keep contacting objects/shadows in a coherent plane; background parallax requires real layers and concealed-area completion.

The simple builder supports ordered continuous scenes, timed sprite exposures and one camera from/to per scene. More elaborate choreography is authored in composition mode, not faked with additional shots. The caller supplies semantic contact/occlusion reasoning; geometry validation cannot replace it.

## Runtime and failures

Install dependencies explicitly with `npm ci --ignore-scripts` inside scripts/runtime. Do not upgrade to latest to bypass a failure. Linux x64 export retains the tested single-worker, software-GPU screenshot/CDP and FFmpeg color compatibility adapters. Other platforms are not claimed tested. Chrome and FFmpeg are external executables; set HYPERFRAMES_BROWSER when Chrome is not at the documented default.

Check/render/preview require a build marker and current compiled hashes. Check only changes build-owned vendor files, not source art. Preview is foreground/owned; stop it when done. Missing dependencies, invalid media, changed sources and existing output directories fail explicitly. Save failed evidence and fix the root layer.

Export technical checks cover H.264 dimensions, fps, exact decoded frame count/duration and expected audio presence. They do not certify aesthetics or listening. Use the separate risk QA commands; repeated delivery of unchanged media reuses matching playback evidence. Historical source paths/hashes remain historical when a runtime is moved.

## Caller-owned packaging

The [packaging template](../assets/templates/packaging.html.template) is an uninstantiated example, not a ready-made creator credit. Copy it into the user's workspace, fill every token from explicit production inputs, HTML-escape label/title/detail text, validate numeric fields and the slug ID, and supply the local font. Do not pass unresolved tokens as an accepted build. Use a genuinely supplied illustration layer for an illustrated cover; this typography skeleton is not a replacement for approved art. It has no fixed author/account, story, title, compulsory duration or music.

The same composition mode can import a richer caller-supplied intro/outro. Include its required image/font files and bind their hashes. The composition build step runs the locked framework's `timeline ids` normalization in the new build before hashing; preview must not rewrite an already bound source. Inspect packaging in the encoded final result, not just in its separate HTML.
