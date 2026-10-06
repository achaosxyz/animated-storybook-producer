# Evidence-driven QA and repair

## Find the responsible layer

Record symptom, artifact version/hash, time/frame, region, expected behavior, observed evidence and competing causes. Use the smallest diagnostic that separates them. Direct evidence may already locate a cause; do not repeat expensive reproduction without a reason.

Trace upstream: story/adaptation → paragraph/storyboard → generated asset → exposure/audio → composition/runtime/encode. Repair at the earliest responsible layer. Invalid wide/detail oscillation is a storyboard problem; baked color drift or duplicate anatomy is an asset problem; a wrong offset is a timing problem. Do not hide them with additional shots, narration, masks, dissolves, camera shakes or relaxed thresholds.

State what must change and what must remain unchanged. Check shared consumers, neighboring cuts and the complete relevant paragraph after a repair. Keep a stable issue ID, cause, affected references, repair count and evidence across versions. Initial review plus at most five repair rounds; renaming files does not reset the count. Unclear cause, exhausted rounds, missing capability or a creative choice is a concrete blocker.

## Visual sequence

1. Overview: obvious crop, blocked subject, missing image or jump fails immediately.
2. Original-size risk frames: anatomy, roots/contact, artwork edges, alpha, support/shadow, depth, identity, captions and intentional-crop justification.
3. Contextual motion: anticipation/contact/result/response, exposure timing, camera endpoints and continuity around cuts.
4. Actual encoded media: decode selected frames and play the final file end-to-end; inspect packaging and audio boundaries.

Technical success cannot cancel visual failure. Missing coverage stays pending. Intentional close-ups must have prior purpose and keep required causal/support details; retrospective relabeling of a bad crop is not acceptance.

## Risk plan, not exhaustive seek

Include first/last frame, every unique pose/state, contact and support event, camera extrema, cut neighborhoods, subtitle extremes, intro/body/outro joins and known failures. At transitions sample both sides and meaningful context. For deterministic browser testing compare the same frame after initial nonzero seek, forward, backward and randomized access, with a real forward baseline. Wait for images and fonts before capturing. Missing baseline is failure, not a skipped comparison.

Pixel equality and perceptual similarity are different checks. Never raise a tolerance to convert an unexplained exact-PNG mismatch into a pass. Extracted encoded frames are naturally codec-affected; report the correct comparison type. A historical failure remains historical, not repaired by moving the runtime.

Do not seek every frame through a browser by default. Full sequential decoding is inexpensive technical verification; browser sampling covers risk. Full encoded playback is one separate end-to-end run. Reuse playback only for identical video hash, environment, check version and implementation hash; source/preview evidence additionally binds source/assets/fonts, runtime and plan. Source-to-encode comparisons bind both.

## Status and delivery

Record `technical`, `visual`, `listening`, `editorial` and `user_gate_c` separately. Use pending/failed/not_applicable explicitly. Browser video ended with no errors proves a playback path, not human listening or aesthetic acceptance. Never write “all checked” from tests alone.

Bind reports to real files and hashes. Preserve failed reports. A playable pending-review copy may be delivered with known limits; stale/missing media or invalid bindings block even that. Do not mark formal acceptance with required checks pending/failed or without real user evidence.
