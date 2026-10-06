# Animated Storybook Producer

English | [简体中文](README.zh-CN.md)

A Codex skill for turning an original or existing character IP into an animated storybook—from character design and script to illustrations, speech, captions and a reviewable video.

**Animate the composition, not just the image.** The result is pose-based 2.5D limited animation: complete character poses, layered scenes, camera moves, sound and pacing—not full 3D animation or improvised detached-limb rigging.

## What you can make

- Original character concepts, relationships and visual references, or stories using your own IP.
- Scripts, storyboards, complete character poses and scene assets.
- Doubao speech, bilingual captions, optional original music and HyperFrames video composition.
- A review bundle with an MP4, viewing entry, check evidence and known limits.

You can request just a script, storyboard or individual production stage. You do not have to start with a complete video.

## Get started in Codex

Install from a local checkout or extracted package into your chosen project:

```bash
DISABLE_TELEMETRY=1 npx skills add /path/to/animated-storybook-producer --skill animated-storybook-producer --agent codex -y
```

Source repository: `git@github.com:achaosxyz/animated-storybook-producer.git`. Replace the example path with the actual skill directory. Then ask Codex to use `animated-storybook-producer` in your own workspace.

Script and planning tasks do not need image generation or speech credentials. Full production requires Codex image-generation access, your own Doubao Speech TTS API key, Node.js >=22, Python 3, FFmpeg/FFprobe and Chrome. ASR credentials are optional. Runtime dependencies must be installed explicitly; installing the skill does not unlock paid services. See [Getting started](references/getting-started.md) for setup.

## A simple creation workflow

1. **Create or import your IP.** Give the audience, character relationship, visual preferences and any existing references. For a new IP, review candidate concepts and confirm the character design and reference art.
2. **Start a story.** Give the theme, language, approximate duration, aspect ratio and intended output. Review the script before production expands.
3. **Confirm the storyboard.** Review the scene sequence, visible actions, pacing, asset needs and sound plan.
4. **Produce the review copy.** Within the confirmed scope, Codex continues through illustrations, speech, captions, composition, optional music and checks. Changes to approved story or identity return to the affected confirmation.
5. **Review and save.** Inspect the actual video and reported limits, request focused revisions, then confirm the result. Saving an archive or publishing is your separate decision.

### Example requests

**Create an IP first:**

> Use animated-storybook-producer to propose three original character-pair concepts for children aged 3–6. Use a playful cartoon style and give each pair names, relationship dynamics and visual direction. Start with concepts only; do not generate images yet.

**Start with an existing IP:**

> Use animated-storybook-producer with the setting and references in ./my-ip/. Create a roughly two-minute landscape storybook about two friends exploring a rainy day. Write the script first; wait for my confirmation before storyboarding.

**Resume a production:**

> Continue the animated storybook in .build/my-story/. Check the saved state and artifacts, then resume the next unfinished stage without regenerating completed work.

## Your files and decisions

Keep your IP, references, approvals and credentials in your own workspace, not inside the installed skill. Production files and the review bundle go under `.build/<task-id>/`; episode organization and long-term archives remain yours to manage. No series characters, creator account or private media are bundled.

Image and speech services may incur fees; calls follow your task authorization or trusted standing authorization. Technical checks, visual review, listening and your final acceptance are reported separately. Missing checks remain pending. The skill does not automatically approve, commit, upload or publish your work.

You can create in Chinese or another requested language. Agent instructions and method references are English; this README is also available in Simplified Chinese.

## Further reading

- [Getting started](references/getting-started.md): setup and inputs.
- [Skill entry](SKILL.md): how Codex routes each production stage.
- [CLI](references/cli.md): local tools and their limits.
