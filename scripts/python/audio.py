"""Explicit original-note rendering and non-destructive PCM edit assembly."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import wave
import numpy as np
from oscillator import oscillator, SR


def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def number(x, lo=0, hi=float('inf')):
    if isinstance(x, bool) or not isinstance(x, (float, int)) or not math.isfinite(x) or not lo <= x <= hi:
        raise ValueError('Invalid numeric field')
    return x


def write_wave(p, a):
    if not np.all(np.isfinite(a)) or np.max(np.abs(a), initial=0) >= 1:
        raise ValueError('Clipping or invalid samples; revise gains, do not normalize silently')
    with wave.open(str(p), 'wb') as w:
        w.setparams((2, 2, SR, 0, 'NONE', ''))
        w.writeframes(np.round(a * 32767).astype('<i2').tobytes())


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('action', choices=['music','assemble'])
    for n in ['workspace','input','out']: ap.add_argument('--'+n, required=True)
    a=ap.parse_args(); root=Path(a.workspace).resolve(strict=True); source=Path(a.input).resolve(strict=True)
    if not source.is_relative_to(root): raise ValueError('Input outside workspace')
    source_hash=digest(source); d=json.loads(source.read_text())
    if d.get('schema_version')!='1': raise ValueError('Expected schema version 1')
    duration=number(d['duration_seconds'], 1/SR, 3600)
    count=round(duration*SR)
    if abs(count-duration*SR)>1e-6: raise ValueError('Duration must resolve to whole samples')
    out=Path(a.out).resolve()
    if not out.is_relative_to(root) or out.exists(): raise ValueError('Output must be new and inside workspace')
    stems={}; bindings=[]
    if a.action=='music':
        for e in d['events']:
            if e['instrument'] not in ['soft_keys','round_reed','wood_pluck','warm_bass','air_chords']: raise ValueError('Unknown instrument')
            for key,lo,hi in [('midi_note',0,127),('velocity',0,1),('pan',-1,1),('duration_seconds',.001,600),('start_seconds',0,duration)]: number(e[key],lo,hi)
            name=e['instrument']; stems.setdefault(name,np.zeros((count,2),dtype=np.float64))
            sound=oscillator(e); start=round(e['start_seconds']*SR)
            if start+len(sound)>count: raise ValueError('Score duration would cut an instrument release tail')
            stems[name][start:start+len(sound)]+=sound
    else:
        for i,e in enumerate(d['clips']):
            name=e['stem']
            if name not in ['voice','music','effects']: raise ValueError('Use voice/music/effects stems; narration belongs to voice')
            p=(source.parent/e['path']).resolve(strict=True)
            if Path(e['path']).is_absolute() or not p.is_relative_to(root) or digest(p)!=e['sha256']: raise ValueError('Audio path or source hash mismatch')
            data=subprocess.run(['ffmpeg','-v','error','-i',str(p),'-f','f32le','-ac','2','-ar',str(SR),'-'],capture_output=True,check=True).stdout
            pcm=np.frombuffer(data,'<f4').reshape(-1,2).astype(np.float64)
            begin=round(number(e.get('source_start',0))*SR); length=round(number(e['duration_seconds'],1/SR)*SR); start=round(number(e['start_seconds'])*SR)
            if begin+length>len(pcm) or start+length>count: raise ValueError('Audio edit would truncate or overflow')
            segment=pcm[begin:begin+length].copy()*10**(number(e.get('gain_db',0),-120,24)/20)
            for key,reverse in [('fade_in',False),('fade_out',True)]:
                n=round(number(e.get(key,0),0,length/SR)*SR)
                if n:
                    ramp=np.linspace(0,1,n)
                    if reverse: segment[-n:]*=ramp[::-1,None]
                    else: segment[:n]*=ramp[:,None]
            stems.setdefault(name,np.zeros((count,2),dtype=np.float64)); stems[name][start:start+length]+=segment
            if digest(p)!=e['sha256']: raise ValueError('Audio changed during decode')
            bindings.append({'path':str(p.relative_to(root)),'sha256':e['sha256']})
    if not stems: raise ValueError('No score events/audio clips supplied')
    mix=sum(stems.values(),start=np.zeros((count,2),dtype=np.float64))
    for track in [*stems.values(),mix]:
        if np.max(np.abs(track),initial=0)>=1 or not np.isfinite(track).all(): raise ValueError('Clipping or invalid samples')
    if digest(source)!=source_hash: raise ValueError('Input changed during processing')
    out.mkdir(parents=True,exist_ok=False)
    try:
        for name,track in stems.items(): write_wave(out/f'{name}.wav',track)
        write_wave(out/'mix.wav',mix)
        report={'status':'completed','schema_version':'1','input_sha256':source_hash,'sources':bindings,'sample_rate':SR,'sample_count':count,'duration_seconds':count/SR,'peak':float(np.max(np.abs(mix))),'clipped_samples':0,'listening':'not_performed','stems':{n:{'path':f'{n}.wav','sha256':digest(out/f'{n}.wav')} for n in stems},'output':{'path':'mix.wav','sha256':digest(out/'mix.wav')}}
        (out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    except Exception:
        (out/'failed.json').write_text('{"status":"failed"}\n'); raise
    print(json.dumps({'status':'completed','out':str(out),'listening':'not_performed'}))

if __name__=='__main__': main()
