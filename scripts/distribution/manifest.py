"""Refresh a public source inventory. A changed inventory invalidates prior validation claims."""
import argparse
import hashlib
import json
import re
from pathlib import Path

EXCLUDED = {'node_modules', '__pycache__', '.git', '.hyperframes', 'vendor', '.venv', '.mar', '.build'}
ROOT_FILES = {'SKILL.md', 'README.md', 'README.zh-CN.md', '.gitignore'}
ROOT_DIRS = {'references', 'scripts', 'assets', 'evals'}
EXTENSIONS = {'.md', '.json', '.mjs', '.py', '.txt', '.html', '.template'}

def check_versions(root, manifest):
    version = manifest.get('version', '')
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?', version):
        raise ValueError('Invalid package version')
    skill = (root / 'SKILL.md').read_text().split('---', 2)
    if len(skill) != 3 or not re.search(r'^  version: ' + re.escape(version) + r'$', skill[1], re.M):
        raise ValueError('SKILL metadata version differs from package manifest')
    runtime = json.loads((root / 'scripts/runtime/package.json').read_text())
    lock = json.loads((root / 'scripts/runtime/package-lock.json').read_text())
    if any(v != version for v in (runtime.get('version'), lock.get('version'), lock.get('packages', {}).get('', {}).get('version'))):
        raise ValueError('Runtime version differs from package manifest')

def inventory(root):
    files = {}
    for p in sorted(root.rglob('*')):
        rel = p.relative_to(root)
        if any(part in EXCLUDED for part in rel.parts):
            continue
        if p.is_symlink():
            raise ValueError('Public source cannot be a symlink: ' + str(rel))
        if not p.is_file() or str(rel) == 'package-manifest.json':
            continue
        if str(rel) not in ROOT_FILES and (rel.parts[0] not in ROOT_DIRS or p.suffix not in EXTENSIONS):
            raise ValueError('Unclassified package file: ' + str(rel))
        if any(part.startswith('.env') for part in rel.parts):
            raise ValueError('Private configuration must not be packaged')
        files[str(rel)] = hashlib.sha256(p.read_bytes()).hexdigest()
    if not ROOT_FILES.issubset(files):
        raise ValueError('Required distribution files missing')
    return files

def refresh(root):
    path = root / 'package-manifest.json'
    manifest = json.loads(path.read_text())
    check_versions(root, manifest)
    files = inventory(root)
    changed = manifest.get('files') != files
    manifest['files'] = files
    manifest['runtime_lock_sha256'] = files['scripts/runtime/package-lock.json']
    if changed:
        manifest['validated'] = {'status': 'pending', 'reason': 'Source inventory changed; previous results do not certify this revision'}
        manifest['release_ready'] = False
    path.write_text(json.dumps(manifest, indent=2) + '\n')
    return {'files': len(files), 'changed': changed, 'validation_reset': changed}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    print(json.dumps(refresh(Path(args.root).resolve())))
