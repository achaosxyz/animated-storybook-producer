# Visual identity and independent sprites

## Identity first

Use the caller's own IP brief and approved references. An approved species pair is not an approved design. Offer a small set of coherent original styles; establish shared material, palette, scale and lighting in a two-character composition before expanding assets. Avoid copying an existing illustrator's signature designs or complete layouts.

A reference kit needs identity silhouettes, proportions, colors, distinctive marks, relevant views and a scale relationship. Generate only views/poses needed for the task, not a speculative full walk cycle. Record source, request, version and approval scope. Only explicit user confirmation freezes a canonical version; static approval does not approve movement.

## Unit of production

A sprite is a complete meaningful object in local coordinates: one whole character pose, a prop/state, necessary complete contact group, external cast shadow or scenery layer. Never request detached spare arms/heads/feet or treat a reference sheet's disassembly as an authorized workflow. The asset plan, generation request, accepted original and composition reference use the same semantic boundary.

Backgrounds remain clean and reusable while characters/props change. Do not regenerate an unchanged entire scene to change one pose: small texture, color and perspective drift creates false cuts. A full-frame illustration is appropriate only for an intentionally separate key image, not as a shortcut around independent components.

Deliver individual RGBA PNGs with compact bounds and safe transparent padding. Do not bake scene positions into a giant mostly-empty canvas. Preserve original generation; trim only completely transparent margins without cropping visible strokes, shadow or body. Size differences between poses are valid; do not stretch visible bounding boxes to a common size.

Register a semantic root (often a support point), native dimensions, optional contact landmarks and world scale for every pose. Scene instances supply placement, exposure, depth and parent relationship. Swapping a pose preserves the scene root and uses the new local pivot. An atlas is optional packaging, not a new production unit.

## Grounding and contact

Keep material shading on the body distinct from external cast shadow. Judge shadows in the actual scene: support, light direction, softness, color and silhouette must agree. A generic oval does not fix floating feet or a curved body's changing support. Contact groups retain each member's root and necessary contact anchors, not just a group center. Record which independent instances the group replaces to prevent duplicate bodies/tails/props.

Use a separate prop when attachment can remain reliable; bake difficult held contact into a complete pose when necessary. Do not split anatomy to increase layer count or expand a small contact group into a whole scene.

## Acceptance and repair

Inspect original pixels, alpha on light/dark backgrounds, a full-body fixed view and the real composed frame. Check identity, material, scale, body continuity, limbs appropriate to species, occlusion completion, support, contact, tail/mark counts and edge clearance. A clean alpha bbox or equal protected-region hash is not aesthetic approval.

Image defects return to image generation with references plus Preserve/Change instructions. No polygon cuts through visible bodies, threshold background erasure, copied texture patches, covering rectangles, warps or dissolves to hide defects. Code may map coordinates, compose accepted layers, zero fully transparent RGB and trim pure transparent margins.

Only isolated, almost-transparent encoding specks clearly separated from genuine strokes may be removed after enlarged diagnosis, with removed-pixel count/max alpha and before/after checks saved. Watercolor fringes, soft shadows and visible halos are not such specks. Do not erase unwanted extra limbs and then declare the generation compliant.
