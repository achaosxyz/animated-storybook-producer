# Public CLI

Use `node /absolute/path/to/animated-storybook-producer/scripts/producer.mjs --help`. The CLI uses Node built-ins at its front door; dependencies resolve inside scripts/runtime. All commands require `--workspace PATH`. Paths are caller-cwd-relative or absolute, never skill-relative. Writing commands require a new `--out DIR` except foreground preview. Direct new production outputs to `<workspace>/.build/<task-id>/`; use the project root for `--workspace`. No automatic installation, provider fallback, episode archival or upload occurs.

| Command | Required options beyond workspace | Optional options |
|---|---|---|
| inspect | none | --state FILE |
| build | --input FILE --out DIR | none |
| check / render | --job BUILD/job.json --out DIR | --quality draft/looks/delivery |
| preview | --job BUILD/job.json | --port NUMBER |
| tts check | --job FILE | --env-file FILE |
| tts synthesize | --job FILE --out DIR | --env-file FILE |
| asr check | none | --audio FILE --env-file FILE |
| asr recognize | --audio FILE --out DIR | --env-file FILE |
| music render / audio assemble | --input FILE --out DIR | none |
| qa plan | --out DIR and exactly one of --job BUILD/job.json / --run DIR | --risks FILE |
| qa sample | --job BUILD/job.json --run DIR --plan FILE --out DIR | none |
| qa encoded | --run DIR --plan FILE --out DIR | none |
| qa playback | --run DIR --out DIR | --reuse REPORT |
| package | --input FILE --out DIR | none |
| deliver | --run DIR --review FILE --out DIR | none |

Network synthesis/recognition runs without an additional payment opt-in flag. The caller selects those billable commands within current task or trusted standing authorization; do not re-prompt for already covered operations. Configuration alone does not authorize unrelated calls. Check operations make zero paid requests. Preview stays foreground; stop with Ctrl+C. CLI errors use status/code; provider messages may retain legacy localization, but never expose secret values.

## Offline path

Use the [neutral fixture generator](../scripts/python/smoke_fixture.py) to create explicitly technical test inputs in a new workspace. It draws simple non-IP geometric states and a test tone, not production art or synthesized speech. It does not establish full-production environment readiness.

```bash
W=/absolute/path/to/your/workspace
P=/absolute/path/to/skill/scripts/producer.mjs
T="$W/.build/smoke-01"  # Choose a new task ID if this already exists.
python3 /absolute/path/to/skill/scripts/python/smoke_fixture.py --out "$T/inputs"
node "$P" build --workspace "$W" --input "$T/inputs/build-input.json" --out "$T/builds/v1"
node "$P" render --workspace "$W" --job "$T/builds/v1/job.json" --out "$T/runs/render-01"
node "$P" qa plan --workspace "$W" --job "$T/builds/v1/job.json" --out "$T/runs/plan-01"
node "$P" qa sample --workspace "$W" --job "$T/builds/v1/job.json" --run "$T/runs/render-01" --plan "$T/runs/plan-01/plan.json" --out "$T/runs/sample-01"
node "$P" qa encoded --workspace "$W" --run "$T/runs/render-01" --plan "$T/runs/plan-01/plan.json" --out "$T/runs/encoded-01"
node "$P" qa playback --workspace "$W" --run "$T/runs/render-01" --out "$T/runs/playback-01"
```

Inspect sampled/encoded pixels and make an honest hash-bound review record before `deliver --workspace "$W" --run "$T/runs/render-01" --review "$T/review.json" --out "$T/delivery"`. A failed exact-PNG test stays failed, even when media playback passes. Review copies disclose it. Packaging parts or changing subtitle/audio inputs requires newly bound outputs and affected QA, not overwriting these directories.

## Mixed audio and silent packaging

For matching picture geometry/fps but different stream layouts (for example, voiced body plus silent outro), set `mode: "normalize"` in the ordered package JSON. This is explicit H.264/AAC re-encoding, not copy mode falling back invisibly. Create the package, then `qa plan --run <package-run>` with cut/contact/caption/join risks; perform encoded QA, playback and a review-bound deliver. Keep the original parts and audio stems unchanged.
