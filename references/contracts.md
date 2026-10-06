# Inputs, state and evidence

All public CLI relative arguments resolve from the caller's cwd once. Paths inside manifests resolve from that manifest's directory; media referenced by HTML resolves from its composition. Inputs are realpath-checked inside the explicit workspace. Only an explicitly selected private env file may be outside it. Output directories must be new and inside the workspace. Never write output into the skill source or an approved project.

## Project and approvals

An IP input points to the caller's identity document/version, reference hashes, approval scope, private voice mapping and optional intro master. Do not duplicate the character bible in state. A state record carries current task/output version, A/B/C evidence, next unfinished action, bindings and issues. CLI inspection checks structure/hash, never authenticates user approval from an arbitrary JSON string.

Each issue has a stable ID, symptom, responsible layer/cause, affected references, `repair_rounds` (0–5 after initial inspection), per-attempt evidence and disposition. Counts persist across artifact names. Unknown paid results remain unknown until investigated.

The bundled blank 0.1 templates describe editorial state and stay unapproved. Runtime job 0.1 is a separate executable contract supporting technical_validation/exploration only. Producer build 1 wraps it; conversion always writes a new input/build, not a silent source-schema rewrite.

## Build schema 1

Required: `schema_version: "1"`, `mode: "sprites" | "composition"`, `id`, `artifact_version`, `purpose`, and `target: {width,height,fps,duration_seconds}`. Root duration must be a positive integer number of frames; supported fps are 24/30/60. Purpose is technical_validation or exploration, not a declaration of formal acceptance.

Every file binding is `{path, sha256}`; hashes are mandatory lowercase SHA-256. Optional `files` contains `{path,sha256,dest}` entries copied into the new build. Composition mode needs a bound `index.html`; declare every local resource. `vendor/gsap.min.js`, job.json and build.json are reserved.

Sprite mode adds:
- `assets`: `{id,path,sha256,role,width,height,pivot:[x,y]}`. Roles: background, character-pose, contact-group, prop, state, shadow, foreground. Files are PNGs; dimensions must match bytes. Pivot is a local semantic anchor, not automatically an alpha center.
- `scenes`: ordered `{id,start,duration,instances,camera?}` covering the entire root without gaps/overlap.
- Each instance: `{id,asset,x,y,scale,z,start,duration}`; exposure times are scene-relative, placement is in scene pixels. ID is unique. Integer z is actual stack order. A contact group replaces rather than duplicates its members; caller validates this semantic relation.
- Camera: `{from:{x,y,scale},to:{x,y,scale}}`, applied to the scene group. No camera data means a static view.

Optional `audio`, `subtitles`, `font` are file bindings. Audio is the full edited WAV track; subtitles are the existing schema 0.1 ms document. Font is explicitly supplied. Composition mode may declare boolean `expect_audio` for its own media; injected audio must not declare false. Captions need audio and font, remain body-bound and use one computed display document for HTML/SRT/VTT. Bundled caption layout supports portrait targets at least 720×1280. Caller-supplied composition mode handles other layouts explicitly.

Build emits job.json, index.html, local files, build.json with input/compiled hashes and risk times. Do not edit a build during check/render/QA; revise input and build a new version.

### Caption document fields

The imported caption JSON uses `schema_version: "0.1"`, `time_unit: "ms"`, and ordered `segments`. Each segment supplies slug `scene_id` and `speaker`, nonempty single-line `text`, integer `start_ms/end_ms`, and a source-relative `audio_path` in the form `audio/<utterance-id>.wav` (lowercase letters/digits/hyphens). A bare filename does not meet this native TTS provenance contract. Preserve the named original utterance in the source record; the composition plays the separately edited full track, not this field directly. If any cue has `text_en`, every cue needs a complete English translation. Optional `display_end_ms` cannot precede the spoken end, overlap the next cue or exceed the body. Source/native timestamp verification is still required for production; invented fixture times are only for explicitly labeled tests.

## Sound schema 1

Music: `{schema_version:"1",duration_seconds,events:[{instrument,midi_note,velocity,pan,start_seconds,duration_seconds}]}`. Instruments are soft_keys/round_reed/wood_pluck/warm_bass/air_chords; explicit notes only, release tails must fit.

Audio edit: `{schema_version:"1",duration_seconds,clips:[{path,sha256,stem,source_start,duration_seconds,start_seconds,gain_db,fade_in,fade_out}]}`. `stem` is voice/music/effects; narration is voice. Times are seconds; gains are dB. Decode to stereo 48kHz; reject out-of-bounds edits and clipping. Each output stem and mix shares duration/origin. No automatic ducking: write explicit clip gains/fades into the edit input.

TTS standalone job 0.1 and ASR parameters retain the tested provider implementation. See the [sample TTS job](../scripts/runtime/examples/backend-smoke/tts-job.json) and [voice guide](voice-subtitles.md). Native speech timestamps and editorial display end remain separate.

## Packaging and review

Package input: `{schema_version:"1",parts:[{path,sha256},...]}` in intended order. Default copy mode requires matching stream signatures and never silently transcodes. Explicit normalize mode handles an audio-bearing body and silent packaging under the constraints below.

Risk input is an array of `{time,reason}` in seconds. `qa plan` combines caller risks with build exposure/caption/scene boundaries and produces sorted frame samples. The agent reviews coverage and adds contact/camera extremes; it is not an automatic semantic risk detector.

A review input binds `video_sha256`, `playback:{path,sha256}`, `visual`, `listening`, and `known_limits:[]`. Both review states must be one of `passed`, `pending`, `failed`, `not_performed`, `not_applicable`; limits must be nonempty strings when present. The viewer always displays visual/listening states and pending user approval, even when no additional limits are declared. These states are caller declarations, not automated aesthetic or listening verification. Delivery validates playback evidence and media, then emits a review copy, never auto-acceptance. Formal user Gate C remains outside the executable status.

Every run preserves input/output hashes, implementation/check versions and performed coverage. `completed` is technical completion; `passed` applies only to the named check. Missing review is pending, not implicit success. Playback reuse binds media/environment/check version; sample QA also binds source/assets/fonts/plan. Never modify historical manifests to make their old paths look current.

## Workspace organization

Use `<workspace>/.build/<task-id>/` as the production area: drafting, generated assets, voice/music sources, edit inputs, compositions, run/QA evidence and the final review bundle all belong there. Create only the subdirectories needed for the task, such as `inputs/`, `assets/`, `audio/`, `builds/`, `runs/` and `delivery/`. Existing caller-owned IP, references and packaging masters are read as inputs; do not move or duplicate their identity source merely to fit the task folder.

Keep `--workspace` set to the caller's project root (so private configuration and source inputs keep the same base), and pass explicit `--out` paths below its `.build/<task-id>/`. The CLI still accepts explicit workspace-contained paths for compatibility and does not silently redirect them: this is the producer's output convention, not a changed argument parser. Never write production output inside the installed skill.

The skill finishes by delivering the `.build` review bundle. It does not allocate episode numbers, create archive versions, or assume a caller-specific directory scheme. The caller decides whether and where to persist the bundle under its own instructions. Keep playback/QA links bundle-relative so copying it does not depend on the task folder. Record whether rebuilding inputs were retained separately; a playable bundle alone is not a complete source archive.

Ignore `.build/` in the caller's version control. Being inside `.build` does not authorize deletion: preserve unique generated originals, uncertain paid responses, approvals and failed evidence until the caller's retention requirements are satisfied. Do not reset repair counts or approval scope by changing task/version names, and do not relocate frozen historical evidence just to conform to this convention.

Packaging accepts `mode: "copy"` (default) or explicit `mode: "normalize"`. Normalize requires already matching width, height and fps; it does not crop or reframe. It uses one H.264/AAC encode, stereo 48kHz, pads absent/short audio to the picture and rejects audio beyond the picture by more than a frame. Preserve original parts. Use it for an audio-bearing body plus silent cover/outro; never silently select it after a copy-mode incompatibility.

Run-based QA plans bind the final video SHA-256, not only geometry. Reordering/repackaging needs a new plan. Risk frames must be sorted and retain declared boundaries; additional agent-selected risks are allowed. Playback reuse also binds the QA implementation hash. Delivery copies its hash-bound playback report into `qa/playback.json` so the review bundle remains verifiable after being moved.
