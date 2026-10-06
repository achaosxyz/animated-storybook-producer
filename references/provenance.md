# Provenance and attribution

These methods were selected, condensed and reorganized into this package. No upstream skill entrypoints, update/publish instructions, accounts, benchmark archives or unrelated runtime adapters are shipped. Source identity is attribution, not installation dependency or inherited authority.

| Upstream source | Pinned revision | Adopted scope |
|---|---|---|
| `iart-ai/motion-design-skills` / `animation-principles` | `3c129f769d90a1328c209c386492333c9ac62312` | Timing, easing, anticipation and restrained overlap → directing.md |
| `iart-ai/web-animation-skills` / `gsap-web` | `b6dba3eb759726845a44163ff0bad70dd9e7fbb6` | Timeline transform ownership; scroll-specific tooling excluded → composition.md |
| `heygen-com/hyperframes` / `hyperframes-animation` | `4e118824b301cd18b773c28864c2f36ca642ff34` | Paused timeline and finite pose exposure; unrelated adapters excluded → composition.md / directing.md |
| `heygen-com/hyperframes` / `hyperframes-cli` | `4e118824b301cd18b773c28864c2f36ca642ff34` | Local check/preview/export responsibilities → composition.md |
| `heygen-com/hyperframes` / `hyperframes-core` | `4e118824b301cd18b773c28864c2f36ca642ff34` | Composition, clips, media and deterministic runtime contract → composition.md |
| `heygen-com/hyperframes` / `hyperframes-keyframes` | `4e118824b301cd18b773c28864c2f36ca642ff34` | Keyframe coverage and reference consistency → visual-assets.md / qa-repair.md |
| `iart-ai/motion-design-skills` / `motion-art-direction` | `3c129f769d90a1328c209c386492333c9ac62312` | Attention hierarchy, restraint and emotional pacing → directing.md |
| `sjy051/music-composition` / `music-composition` | `07cecf9c8fd15249ea3da311dc9a7c7893ff801f` | Motif variation, phrasing and voice leading → music.md (adapted, condensed English) |
| `calesthio/generative-media-skills` / `music-supervision-scoring` | `8c85352d5d75d4dcbe58480bd138e37b9742bab1` | Score/stem/cue/mix separation and listening boundaries → music.md |
| `iart-ai/motion-design-skills` / `shot-composition` | `3c129f769d90a1328c209c386492333c9ac62312` | Focal hierarchy, protected regions and spatial layers → directing.md |
| `toyme/storyboard-skill` / `storyboard-skill` | `a8908aabcf9e9585220dfda4d7656f95f68b3610` | Compact production tracking, identity continuity and Preserve/Change requests → visual-assets.md / image-generation.md |
| `iart-ai/web-animation-skills` / `svg-animation` | `b6dba3eb759726845a44163ff0bad70dd9e7fbb6` | Seek-safe vector detail animation boundaries → composition.md |

Repository sources can be resolved as `https://github.com/<owner>/<repository>/tree/<revision>`. Original upstream authors/copyright notices are retained in the license texts below. Music-composition materials from sjy051/music-composition are CC BY 4.0; the theory guidance is adapted and condensed, not an unmodified reproduction. No original project melody or private media is bundled.

- [HyperFrames license](../licenses/heygen-hyperframes.txt)
- [Motion design license](../licenses/motion-design.txt)
- [Web animation license](../licenses/web-animation.txt)
- [Storyboard license](../licenses/storyboard.txt)
- [Music composition attribution/license](../licenses/music-composition.txt)
- [Music supervision license](../licenses/music-scoring.txt)

Runtime libraries are pinned independently in [package-lock.json](../scripts/runtime/package-lock.json). The Linux capture/FFmpeg compatibility implementation and speech lifecycle were migrated from the host project; ownership is not silently reassigned. Original package contributions are licensed under [Apache-2.0](../LICENSE), copyright 2026 achaosxyz and contributors. Third-party terms and attribution continue to apply; the package license does not relicense upstream materials, user IP, generated media or provider services.

Skills CLI packaging/discovery was checked against the official vercel-labs/skills README: `https://github.com/vercel-labs/skills`. Use a directory containing SKILL.md with name/description YAML; local installation is tested separately from remote publication. No CLI source code is copied.

## Provider protocol references

These are protocol sources used by the migrated adapters, not proof that any current account/voice is authorized or live-tested in a community installation. The local migration did not call these providers.

```text
Doubao TTS: https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh
Voice catalogue: https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1
API key model: https://docs.volcengine.com/docs/DoubaoVoice/APIKeyUsage?lang=zh
Doubao streaming ASR: https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh
```

The production image requirement is the actual Codex host tool, not a hard-coded model or an assumption that an API key unlocks that tool. Host instructions take precedence over this package's generic image workflow.
