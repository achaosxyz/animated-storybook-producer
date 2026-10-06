# Original music and picture scoring

Keep four layers separate: composition source → instrument/performance rendering → picture cue edit → final mix. A WAV with hard-coded dialogue gaps is still edit-bound, not a reusable independent score.

## Compose before synchronizing

Define emotional role, energy ceiling, motif and a small timbral palette. For intimate children's stories, leave room for narration and uncertainty; constant cheerful underscoring can flatten the relationship. Use silence intentionally. Music does not cure repetitive cuts or missing story cause.

Write a short singable motif with an identifiable rhythm/contour, then vary one dimension at a time: register, density, mode/harmonic support, articulation or instrumentation. Repetition establishes recognition; contrast follows the emotional turn. Favor clear voice leading and phrase endings over changing chords for every action. Resolve or deliberately suspend the final phrase according to the story, not a fixed loop length.

For a no-external-resources task, specify original notes and synthesize locally. The bundled renderer accepts explicit note events using soft keys, round reed, wood pluck, warm bass and air chords. These are synthetic instruments, not live recordings or a claim of orchestral quality. It does not compose automatically, download samples or call a music model.

## Render and edit

Preserve score events, tempo interpretation and instrument settings. All stems share one origin and duration. Keep release tails; reject a score duration that cuts them off. Render stems and a reconstruction mix separately; reject clipping instead of normalizing every stem independently.

After picture timing is stable, place phrase ranges using a cue edit list with source hashes, source trim, target start, gain and fades. Music may bridge a cut. Do not change cues every time a pose changes or force the picture to hit every beat. A changed edit usually requires cue changes, not recomposing the original motif.

Use voice-aware gain automation in the mixing layer, preserving voice/music/effects stems. Narration belongs in the independent voice stem as well as the mix. Keep dialogue intelligible, transitions gentle and low-frequency energy controlled; assess this by listening, not solely by peak values.

## QA and rights

Check full decoding, exact duration/sample count, clipping, tails, stem reconstruction and mono compatibility. A naturally ending cue is not automatically a seamless loop; verify loop seam separately. Record listening and picture-fit review independently from signal checks.

Original composition records establish process, not global similarity search or legal clearance. Do not download music or samples when the user requested original local work. A standalone music task does not authorize rewriting speech or replacing the current film.
