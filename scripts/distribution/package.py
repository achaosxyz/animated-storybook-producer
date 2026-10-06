"""Create a local whitelist archive; never publish."""
import argparse, hashlib, json, re, tarfile
from pathlib import Path
from manifest import check_versions, inventory

def validate(root):
    m=json.loads((root/'package-manifest.json').read_text())
    if m['name']!='animated-storybook-producer' or not m.get('version'): raise ValueError('Invalid package identity')
    check_versions(root, m)
    if inventory(root) != m.get('files'): raise ValueError('Public inventory changed; refresh and revalidate before packaging')
    for name,expected in m['files'].items():
        if Path(name).is_absolute() or '..' in Path(name).parts: raise ValueError('Non-relative package entry')
        p=root/name
        if p.is_symlink() or not p.resolve().is_relative_to(root.resolve()) or not p.is_file(): raise ValueError('Missing/escaped/symlink file: '+name)
        if any(v in ['node_modules','.mar','.git','.build','__pycache__'] or v.startswith('.env') for v in Path(name).parts) or p.suffix in ['.mp4','.wav','.png','.jpg','.pyc','.pem','.key','.p12']: raise ValueError('Private/generated content: '+name)
        b=p.read_bytes()
        if hashlib.sha256(b).hexdigest()!=expected: raise ValueError('Hash mismatch: '+name)
        if re.search(rb'BEGIN [A-Z ]*PRIVATE KEY',b): raise ValueError('Project-specific or secret-bearing data: '+name)
    text=(root/'SKILL.md').read_text()
    if not text.startswith('---\n') or 'name: animated-storybook-producer\n' not in text or not re.search(r'^description: .+$',text,re.M): raise ValueError('Invalid SKILL frontmatter')
    return m

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--out',required=True);a=p.parse_args();r=Path(a.root).resolve();o=Path(a.out)
    m=validate(r)
    if o.exists(): raise ValueError('Archive output already exists')
    o.parent.mkdir(parents=True,exist_ok=True)
    with tarfile.open(o,'x:gz') as t:
        for n in sorted([*m['files'],'package-manifest.json']): t.add(r/n,arcname=r.name+'/'+n,recursive=False)
    print(json.dumps({'status':'local-archive','path':str(o),'files':len(m['files'])+1,'release_ready':False}))
if __name__=='__main__':main()
