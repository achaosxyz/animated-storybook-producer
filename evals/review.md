# Maintainer behavior review

Method: direct tabletop inspection against the ten prompts in [evals.json](evals.json). This is not execution by an independent agent, a blind comparison, a scored creativity benchmark or proof of automatic triggering.

| Case | Route and checked behavior | Assessment |
|---|---|---|
| 1 | SKILL start/environment + visual-assets: planning is allowed without paid production, original candidate identity only | Instruction coverage present |
| 2 | SKILL Gate A: draft is not confirmation, stop before expansion | Instruction coverage present |
| 3 | Gate B/continuous production + composition/QA: no extra image gates, media evidence and limits required | Instruction coverage present; runtime smoke tested separately |
| 4 | Voice/captions + resume: display punctuation does not force synthesis | Instruction coverage present; native/display boundaries have unit tests |
| 5 | QA root-cause chain + visual-assets: asset fault returns to source and shared consumers | Instruction coverage present; aesthetic judgment not automated |
| 6 | Stable issue, rounds 0–5 and blocker | Instruction coverage present; count bounds have unit tests |
| 7 | Playback hash/environment/check version reuse | Instruction coverage present; CLI supports explicit reuse |
| 8 | Technical/visual/listening/user C separation | Instruction coverage present; deliver emits review-copy, never accepted |
| 9 | Per-request success/failure/unknown records | Instruction coverage present; no automatic image API orchestration claimed |
| 10 | Composition/instrument/cue/mix separation, explicit score events | Instruction coverage present; local synthesis exercised separately |

Remaining limits: no community Codex image request, no new live Doubao credentials test, no human listening result, no new character-art or whole-story aesthetic benchmark. Prompt coverage is not a pass rate. Creative quality remains subject to actual artifact review.
