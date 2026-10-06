import numpy as np
SR = 48000

def oscillator(e):
    kind=e['instrument']; dur=e['duration_seconds']; release=1.6 if kind=='soft_keys' else 1.15
    t=np.arange(round((dur+release)*SR))/SR; f=440*2**((e['midi_note']-69)/12)
    y=np.zeros(len(t))
    if kind=='soft_keys':
        for k,a in enumerate([1,.32,.12,.045,.018],1):
            y+=a*np.sin(2*np.pi*f*k*np.sqrt(1+.000022*k*k)*t)*np.exp(-t/(1.9/k**.65))
        y*=(1-np.exp(-t/.008))*np.exp(-np.maximum(t-dur,0)/.26)
    elif kind=='round_reed':
        vibrato=.003*(1-np.exp(-t/.35))*np.sin(2*np.pi*4.7*t)
        phase=2*np.pi*f*np.cumsum(1+vibrato)/SR
        y=(np.sin(phase)+.20*np.sin(2*phase)+.085*np.sin(3*phase))
        y*=(1-np.exp(-t/.055))*np.exp(-t/4)*np.exp(-np.maximum(t-dur,0)/.12)
    elif kind=='wood_pluck':
        for k,a in [(1,1),(2,.19),(3,.07),(4.01,.025)]:y+=a*np.sin(2*np.pi*f*k*t)*np.exp(-t/(.45/k**.5))
        y*=(1-np.exp(-t/.004))*np.exp(-np.maximum(t-dur,0)/.12)
    elif kind=='warm_bass':
        y=(np.sin(2*np.pi*f*t)+.14*np.sin(4*np.pi*f*t))*(1-np.exp(-t/.028))*np.exp(-t/1.5)*np.exp(-np.maximum(t-dur,0)/.13)
    else:
        y=(np.sin(2*np.pi*f*t)+.12*np.sin(4*np.pi*f*t))*(1-np.exp(-t/.32))*np.exp(-np.maximum(t-dur,0)/.26)
    fade=min(len(y),round(.06*SR));y[-fade:]*=np.linspace(1,0,fade)
    y*=e['velocity']*.20
    theta=(e['pan']+1)*np.pi/4
    return np.stack([y*np.cos(theta),y*np.sin(theta)],axis=1).astype(np.float32)
