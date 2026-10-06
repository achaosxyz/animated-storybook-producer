# Getting started with your own IP

## Install and inspect

Install with the `skills` CLI from a local extracted skill directory into the selected project. Use a real owner/repository only after a release actually exists. The skill uses standard SKILL.md YAML metadata and bundled references/scripts/assets; it needs no proprietary repository registry or additional business skills.

```bash
DISABLE_TELEMETRY=1 npx skills add /path/to/animated-storybook-producer --skill animated-storybook-producer --agent codex -y
```

First identify where the CLI installed the skill. Set SKILL to that absolute directory. For runtime work, install locked dependencies explicitly:

```bash
cd "$SKILL/scripts/runtime"
npm ci --ignore-scripts
python3 -m venv /path/to/your/workspace/.venv
/path/to/your/workspace/.venv/bin/pip3 install -r "$SKILL/scripts/python/requirements.txt"
node "$SKILL/scripts/producer.mjs" --help
```

Activate the venv before Python-dependent commands. Node >=22, FFmpeg/FFprobe and Chrome are required for rendering/QA; Python with NumPy/Pillow is needed for score/audio and test-image tools. Linux x64 is the validation target. Set HYPERFRAMES_BROWSER to an executable Chrome path if `/usr/bin/google-chrome` does not exist. npm dependencies are pinned; do not silently upgrade. Read-only installed packages require an explicitly prepared writable installation/runtime copy; external runtime caches are not an implemented mode.

Pure story/planning tasks need no renderer installation. Text installation, runtime installation, actual image tooling, provider authentication, visual inspection and listening are separate checks.

## Configure your own speech

Create a private `.env/volcengine-tts.env` in your workspace, ignored by your VCS and preferably mode 600. Fill the user's values, not sample secrets:

```dotenv
VOLCENGINE_TTS_API_KEY=
VOLCENGINE_TTS_RESOURCE_ID=seed-tts-2.0
VOLCENGINE_TTS_SPEAKER_NARRATOR=
```

Add speaker variables matching your own TTS jobs. `tts check --job ...` reads local readiness only. Real `tts synthesize` requires provider access and task or trusted standing authorization; no separate payment opt-in is required. Never assume a successful local check proves current voice availability or remote authentication. Optional ASR has its own API key/resource file; see [Voice](voice-subtitles.md).

Full production additionally needs actual Codex image generation. Verify it with the available host tools and follow their mandatory workflow, not a guessed CLI/API. Missing imagegen or TTS key blocks full-production readiness. Clearly scoped planning and offline edits can still proceed. Do not substitute silent output while calling the whole task complete.

## Choose your starting point

- New IP: give audience, language, relationship goals and visual preferences. The producer proposes original candidates and waits for the necessary selection/identity approvals.
- Existing IP: provide a setting document, real identity references, approved scope, and voice/intro inputs when available. Missing files are reported, not replaced with another series.
- Existing episode: provide current script/storyboard/state/run evidence. Resume the next incomplete stage rather than generating everything again.

Keep project data outside the installed skill. Produce task work and the review bundle in the caller workspace’s `.build/<task-id>/`, ignored by version control; leave persistence and any episode/version organization to the caller. Minimum sequence: environment/inputs → identity as needed → story A → storyboard B → continuous authorized production → QA and review copy → user C. Methods are in the skill; only user facts, choices and evidence belong in your project.

For a no-key technical rehearsal, use the neutral [CLI smoke path](cli.md). Its two geometric states and test tone validate software plumbing only. It is not a generated character, genuine TTS response, listening review or high-quality story sample.

## Share without leaking

The local distribution script packages only enumerated public files from package-manifest.json and validates their hashes. No node_modules, cache, environment files, generated media or user project should enter the archive. Retain licenses/provenance. Original contributions use Apache-2.0; third-party terms remain applicable. Agent publication still requires explicit authorization. No upload/push command is part of the tool.

## Maintaining the package

After a deliberate source edit, run `python3 scripts/distribution/manifest.py --root <skill-directory>`. It inventories the public files and resets validation metadata when sources changed; it does not run tests or infer release readiness. Run runtime tests, the affected integration/behavior checks, and document actual coverage before updating validation evidence. Then use `scripts/distribution/package.py --root <skill-directory> --out <new-archive.tar.gz>` for a local archive. Keep run-specific evidence outside the package; never carry a passed claim across changed source hashes.

For branches, version consistency and standalone maintainer tests, see [Maintenance](maintenance.md).
