# Animated Storybook Producer

English | [简体中文](README.zh-CN.md)

**Version: 0.1.0** · Apache-2.0 · `develop` for iteration / `main` for the stable baseline. See [Maintenance](references/maintenance.md).

A Codex skill for original animated storybooks: bring your own IP, approve the story and storyboard, then create complete poses, Doubao speech, bilingual captions, optional original music and a HyperFrames review copy. Animate the composition—not detached anatomy.

Instructions and references are English. Separate English and Simplified Chinese READMEs are provided; story language belongs to the user. No series identity, creator account, private media or credentials are bundled.

## Use in Codex

Use this skill in Codex with image-generation access. Provide your own Doubao Speech TTS API key for voice production; ASR credentials are optional. Codex checks runtime dependencies and installs them when permissions and network access allow. See [Getting started](references/getting-started.md) for environment setup.

Source repository: `git@github.com:achaosxyz/animated-storybook-producer.git`.

Read [Getting started](references/getting-started.md), the [Skill entry](SKILL.md) and task-specific references. Keep your IP, approvals and keys in your own workspace. The skill produces task work and its review bundle under that workspace’s `.build/<task-id>/`; episode/version archival is the caller’s responsibility. See [CLI](references/cli.md) for executable contracts and limitations.

Licensed under [Apache-2.0](LICENSE).
