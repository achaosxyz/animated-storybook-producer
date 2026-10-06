"""Standalone distribution regressions; no consumer repository imports."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import manifest
import package


class DistributionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in manifest.ROOT_FILES:
            (self.root / name).write_text('fixture')
        (self.root / 'SKILL.md').write_text('---\nname: animated-storybook-producer\ndescription: Test fixture\nmetadata:\n  version: 0.1.0\n---\n')
        (self.root / 'README.md').write_text('**Version: 0.1.0**\n**版本：0.1.0**\n')
        runtime = self.root / 'scripts/runtime'
        runtime.mkdir(parents=True)
        (runtime / 'package.json').write_text(json.dumps({'version': '0.1.0'}))
        (runtime / 'package-lock.json').write_text(json.dumps({'version': '0.1.0', 'packages': {'': {'version': '0.1.0'}}}))
        (self.root / 'package-manifest.json').write_text(json.dumps({'name': 'animated-storybook-producer', 'version': '0.1.0', 'files': {}, 'validated': {'status': 'passed'}}))

    def test_refresh_invalidates_only_changed_sources_and_excludes_build(self):
        self.assertTrue(manifest.refresh(self.root)['validation_reset'])
        self.assertEqual('pending', json.loads((self.root / 'package-manifest.json').read_text())['validated']['status'])
        self.assertFalse(manifest.refresh(self.root)['changed'])
        (self.root / '.build/task').mkdir(parents=True)
        (self.root / '.build/task/private.json').write_text('{"private": true}')
        self.assertFalse(manifest.refresh(self.root)['changed'])
        self.assertNotIn('.build/task/private.json', manifest.inventory(self.root))
        package.validate(self.root)

    def test_version_drift_blocks_refresh_and_package(self):
        manifest.refresh(self.root)
        for name in ['SKILL.md', 'README.md', 'scripts/runtime/package.json', 'scripts/runtime/package-lock.json']:
            p = self.root / name
            original = p.read_text()
            p.write_text(original.replace('0.1.0', '0.2.0'))
            with self.subTest(name=name):
                with self.assertRaises(ValueError): manifest.refresh(self.root)
                with self.assertRaises(ValueError): package.validate(self.root)
            p.write_text(original)

    def test_unlisted_source_blocks_package(self):
        manifest.refresh(self.root)
        (self.root / 'scripts/new.py').write_text('pass\n')
        with self.assertRaises(ValueError): package.validate(self.root)

    def test_tampered_hash_and_symlink_block_package(self):
        manifest.refresh(self.root)
        p = self.root / 'LICENSE'
        p.write_text('changed')
        with self.assertRaises(ValueError): package.validate(self.root)
        p.unlink()
        p.symlink_to(self.root / 'README.md')
        with self.assertRaises(ValueError): package.validate(self.root)

    def test_submodule_pointer_is_not_distributed(self):
        manifest.refresh(self.root)
        (self.root / '.git').write_text('gitdir: ../../../.git/modules/example\n')
        self.assertFalse(manifest.refresh(self.root)['changed'])
        self.assertNotIn('.git', package.validate(self.root)['files'])

    def test_forged_build_allowlist_is_rejected(self):
        manifest.refresh(self.root)
        (self.root / '.build').mkdir()
        p = self.root / '.build/private.json'
        p.write_text('{}')
        m = json.loads((self.root / 'package-manifest.json').read_text())
        m['files']['.build/private.json'] = manifest.hashlib.sha256(p.read_bytes()).hexdigest()
        (self.root / 'package-manifest.json').write_text(json.dumps(m))
        with self.assertRaises(ValueError): package.validate(self.root)


if __name__ == '__main__':
    unittest.main()
