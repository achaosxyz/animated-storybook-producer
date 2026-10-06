# Doubao voice, independent ASR and bilingual captions

## Private configuration

Full production requires the user's Doubao Speech TTS API key. The implementation retains provider ID `volcengine` and `VOLCENGINE_*` environment names for compatibility. Use an explicit `--env-file`, otherwise the explicitly selected workspace's `.env/volcengine-tts.env`. Do not search other projects or home directories for keys. Process environment overrides the selected file; configuration is parsed as data, never shell-sourced.

Use `VOLCENGINE_TTS_API_KEY`, `VOLCENGINE_TTS_RESOURCE_ID` (supported default `seed-tts-2.0`) and caller-owned speaker mappings such as `VOLCENGINE_TTS_SPEAKER_NARRATOR`. Keep files private/ignored, preferably mode 600. Do not put values or secret hashes in run records. `tts check` performs local readiness checks, not remote authentication.

Run TTS synthesis directly within task authorization or trusted standing authorization; do not add a per-call payment prompt or CLI opt-in. A caller may authorize routine use of configured project TTS for its creative tasks; the skill does not infer that policy from credentials alone. Preserve each response, audio hash, measured duration, request ID and native word timestamps. Unsupported direction/voice combinations fail before requests. Emotion/tone instructions belong in the provider's direction field, not spoken text. The implementation sends supported 2.0 direction as additions JSON; never promise all voices express every requested emotion.

## Sound editing

Generate and retain independent utterance sources. Keep narrator, character, music and effects stems separately. Track source interval, target start, gain and fades in an edit decision list. Do not overwrite original voices or bake editorial silence into the only source.

Measure actual decoded audio, not text length. Long gaps may be meaningful response/read time or accidental waiting; inspect the action and listen before removing them. Shortened gaps require real timeline changes to poses, events, camera keys, audio starts, captions, body duration and outro offset. A new voice or longer caption display alone does not change the video length.

Reuse unchanged source bytes/native relative word boundaries. A changed utterance invalidates its voice/timing and downstream checks, not every source in the episode. Overflow returns to edit planning; never silently truncate speech, guess timestamps or mark partial provider results complete.

## Captions

Keep spoken Chinese, English translation, native speech boundaries and optional display end separate. English is a readable translation of the same utterance, not an English audio track or English word alignment. Preserve speaker boundaries and meaning. Use natural short subtitle English, not literal prose, ornamental fonts or a claim of “cinema-grade” without review.

Use complete Chinese text above English in fixed bottom slots; do not move captions per shot. No solid white panel by default. Font, color/shadow and size must be tested on actual backgrounds and phone-sized output. The caller determines acceptable picture occlusion; captions themselves must not clip or overlap. Chinese clause wrapping must avoid orphan glyphs/awkward word breaks.

Native `start_ms/end_ms` remain unchanged. `display_end_ms` may extend reading time without crossing the next cue or body end. The supplied layout's bilingual planning default is at least 1.8 seconds and at most 17 English Unicode characters/second, but boundary truncation can still violate the budget. Review and shorten/resegment translation or adjust the edit rather than pretending non-overlap proves readability. Export JSON, SRT/VTT and the on-screen text from one reviewed display document.

A terminal colon used only to introduce a later thought can be omitted in the display version when meaning is unchanged. Do not delete all colons, alter times/ratios, remove meaningful question marks or change synthesized speech merely to adjust display punctuation. Captions end before an author outro.

## ASR is separate

Use `.env/volcengine-asr.env` or explicit `--env-file`; configure `VOLCENGINE_ASR_API_KEY` and a supported streaming resource such as `volc.seedasr.sauc.duration`. No TTS-key fallback. Local audio validation/decoding is not recognition. `asr recognize` uploads the explicitly selected local audio to the configured provider within its own task or standing authorization; a TTS-only policy does not grant ASR upload scope.

The adapter streams decoded mono 16kHz PCM in paced packets, keeps only a complete final result and does not follow redirects with credentials. Unknown speakers remain null; missing words remain absent, not invented. ASR supports transcription/checking, not automatic replacement of reliable native TTS timestamps or automatic speaker identity. Network failures retain failed evidence and do not trigger blind retries.

## Acceptance

Separate local readiness, actual provider response, decoded signal checks, transcript review, listening, mix judgment and user approval. Measure duration, clipping, loudness/peaks and source alignment; these do not establish pleasant voice, believable emotion or music balance. Without listening, record `not_performed`. No bundled credentials, paid smoke requests or inherited account assumptions.

## Provider protocol references

These describe provider protocols, not proof that an account or voice is authorized or live-tested in this installation.

```text
Doubao TTS: https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh
Voice catalogue: https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1
API key model: https://docs.volcengine.com/docs/DoubaoVoice/APIKeyUsage?lang=zh
Doubao streaming ASR: https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh
```
