# Maintaining the skill

## Branches and version

Use `develop` for iteration and `main` for the reviewed stable baseline. A branch name is not validation evidence or a published release. Normal submodule checkout is detached at the consumer's pinned commit; switch to `develop` explicitly before authorized maintenance. Do not overwrite local edits or move a consumer pin silently.

The package version's source of truth is `package-manifest.json.version`. Mirror it in SKILL metadata, the English [README](../README.md), the [Simplified Chinese README](../README.zh-CN.md), runtime package.json and the lockfile's root versions. Keep the two READMEs equivalent in scope, requirements, installation and capability limits, with reciprocal language links. Distribution refresh and packaging reject version mismatches. Input schema versions and QA implementation versions are independent; do not bump them merely to match the package.

Write skill Git commit messages in English Conventional Commit format: `type: English summary` or `type(scope): English summary`, for example `docs: split English and Chinese READMEs`. Use feat/fix/docs/refactor/test/chore/perf/build/ci/revert as appropriate. Consumer repositories choose their own commit language. Do not rewrite existing commits merely to change their language without explicit authorization.

Use semantic versions: patch for compatible corrections, minor for compatible capability additions, major for incompatible public contracts. Iterations may use a prerelease such as `0.1.1-dev.1`; a stable candidate drops the prerelease only after its checks. Promote reviewed commits from `develop` to `main` only with explicit authorization. Tagging, pushing and public release are separate actions, not consequences of tests or a commit request. Never force-reset either branch to hide divergence.

## Independent checks

From the skill root, with the documented dependencies installed:

```bash
python3 -m unittest discover -s scripts/distribution/tests -v
npm --prefix scripts/runtime test
python3 scripts/distribution/manifest.py --root .
git diff --check
```

Refresh inventories after deliberate edits; it invalidates old validation claims rather than certifying the new revision. Use the [CLI smoke path](cli.md) for changed execution paths, and inspect real encoded output and viewer states. Run evidence belongs in the caller workspace's `.build/<task-id>/`, not the source package. Paid generation and listening require their own capabilities and authorization. Record missing checks honestly.

Package into a new path using `scripts/distribution/package.py`. Recheck the extracted package's manifest, standalone tests and dependency resolution without importing the consumer repository. Public original code and method resources use [Apache-2.0](../LICENSE); retain [third-party notices](provenance.md). Do not include user IP, credentials, generated media, caches or private evidence in commits or archives.

## Consumer and maintainer boundaries

Consumers lock a reviewed commit and keep their IP, configuration, approvals and production outputs outside the installed skill. Maintainers change only generic methods, contracts, tests and tools inside the skill. Commit skill changes first; update a consumer's gitlink separately under that repository's authorization. Before sharing a parent commit, ensure its pinned skill commit is fetchable from the configured remote; a local-only commit cannot support a fresh remote clone. The runtime does not enforce branch protection or automatically publish either repository.
