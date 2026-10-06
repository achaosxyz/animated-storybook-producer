"""Create neutral, explicitly non-production offline integration inputs."""
import argparse, hashlib, json, wave
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
p=argparse.ArgumentParser();p.add_argument('--out',required=True);a=p.parse_args()
r=Path(a.out);r.mkdir(parents=True,exist_ok=False)
def bind(name): return {'path':name,'sha256':hashlib.sha256((r/name).read_bytes()).hexdigest()}
bg=Image.new('RGBA',(720,1280),'#f4efdf');dr=ImageDraw.Draw(bg);dr.rectangle((0,800,720,1280),fill='#c8d8bb');bg.save(r/'background.png')
for k in [0,1]:
 im=Image.new('RGBA',(160,200));d=ImageDraw.Draw(im);d.ellipse((15,10,145,190),fill='#477e75');d.ellipse((50,55,60,65),fill='#182d29');d.ellipse((100,55,110,65),fill='#182d29');d.arc((55,75,108,120 if k else 100),0,180,fill='#182d29',width=4);im.save(r/f'state-{k}.png')
t=np.arange(4*48000)/48000;tone=.015*np.sin(2*np.pi*440*t)*np.minimum(t/.05,1)*np.minimum((4-t)/.1,1)
with wave.open(str(r/'tone.wav'),'wb') as w:w.setparams((2,2,48000,0,'NONE',''));w.writeframes(np.round(np.stack([tone,tone],1)*32767).astype('<i2').tobytes())
assets=[dict(id='background',**bind('background.png'),role='background',width=720,height=1280,pivot=[0,0])]+[dict(id=f'state-{k}',**bind(f'state-{k}.png'),role='state',width=160,height=200,pivot=[80,190]) for k in [0,1]]
scenes=[]
for k in [0,1]:
 scenes.append({'id':f'scene-{k}','start':k*2,'duration':2,'instances':[{'id':f'bg-{k}','asset':'background','x':0,'y':0,'scale':1,'z':0,'start':0,'duration':2},{'id':f'figure-{k}','asset':f'state-{k}','x':300,'y':880,'scale':1 if k==0 else 1.15,'z':1,'start':0,'duration':2}]})
d={'schema_version':'1','mode':'sprites','id':'neutral-smoke','artifact_version':'smoke-v1','purpose':'technical_validation','target':{'width':720,'height':1280,'fps':30,'duration_seconds':4},'assets':assets,'scenes':scenes,'audio':bind('tone.wav')}
(r/'build-input.json').write_text(json.dumps(d,indent=2)+'\n')
(r/'score.json').write_text(json.dumps({'schema_version':'1','duration_seconds':4,'events':[{'instrument':'soft_keys','midi_note':60,'velocity':.3,'pan':0,'start_seconds':0,'duration_seconds':1}]},indent=2)+'\n')
(r/'audio-edit.json').write_text(json.dumps({'schema_version':'1','duration_seconds':4,'clips':[dict(**bind('tone.wav'),stem='voice',source_start=0,duration_seconds=4,start_seconds=0,gain_db=-3,fade_in=.02,fade_out=.05)]},indent=2)+'\n')
print(r.resolve())
