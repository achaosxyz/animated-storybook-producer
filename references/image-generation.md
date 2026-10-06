# Image generation in Codex

The required full-production environment is Codex with an actually available image-generation tool. Tool availability, reference selectors, model naming and image return behavior depend on the host. Follow its current mandatory image-tool instructions before requests. Do not invent an HTTP bridge, assume every Codex session includes image generation, or prescribe private host tool names as public APIs.

## Request contract

Each request states one complete deliverable, its identity/style references, role, pose/view, preserved features, permitted changes, lighting, alpha/background requirement and protected contours. Resolve reference images first; never silently omit missing references. Inspect unseen references when image viewing is available and do not claim inspection on a text-only model.

Request a complete character pose, never detachable replacement anatomy. Separate clean backgrounds, complete props/states and external shadows only where their spatial relationships remain reliable. Necessary held props or two-person contact may be one complete unit. Do not include extra variants/spare parts in one deliverable to be cut apart later.

Same-scene assets share a style/light/perspective reference; identity uses the approved character master. Do not ask the generator to encode absolute scene placement into each transparent sprite. The compositor owns placement. Store image dimensions, local root and contact points after inspection.

## Bounded parallel production

Run independent requests concurrently when all references and decisions are ready and the host allows it. One request returns one complete planned asset. Identity approval, an unmade background reference or a generated contact dependency makes requests sequential. Parallelism is not permission for extra paid variations.

Record stable asset/request IDs, intended input references and hashes, actual prompt/tool/model metadata when available, returned original path/hash and independent status. Save successes immediately. An uncertain result is `unknown`, not an automatic retry; inspect saved requests/returns first. Do not resend a whole successful batch because one image failed.

## Review

Inspect returned pixels, not just a tool's success flag. Check completeness, unwanted spare elements, identity, perspective, same-scene consistency and alpha edges; then inspect the layered composition. Preserve original files and rejected evidence. A repair request must name the observed defect and Preserve/Change scope, include sufficient references, and retain the same stable issue/repair count. Five repair rounds are a ceiling, not a target.

Generation success does not mean user approval or production acceptance. Missing image tooling blocks new image production; use existing approved assets only when that is the requested scope, not as a concealed substitute for full environment readiness.
