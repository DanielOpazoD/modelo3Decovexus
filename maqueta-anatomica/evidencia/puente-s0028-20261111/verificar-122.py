"""Scalar verification with struct float32, independent of the vectorized pilot."""
import hashlib
import json
import math
import struct
from pathlib import Path

import numpy as np

here=Path(__file__).resolve().parent
result=json.loads((here/'122-RESULT.json').read_text())
payload=(here/'datos-122/SAMPLES.npz').read_bytes()
assert hashlib.sha256(payload).hexdigest()==result['samplesSha256']
samples=np.load(here/'datos-122/SAMPLES.npz')
boxes={'right':([-108.48527431275116,-89.21478450019774,-202.48879268882285],[81,81,96]),
       'left':([8.514725687248841,-83.21478450019774,-194.98879268882285],[81,74,105])}
def f32(x): return struct.unpack('<f',struct.pack('<f',x))[0]
def next_up(x):
    if x==0.: return struct.unpack('<f',struct.pack('<I',1))[0]
    bits=struct.unpack('<I',struct.pack('<f',x))[0]
    return struct.unpack('<f',struct.pack('<I',bits+1 if x>0 else bits-1))[0]
def next_down(x): return -next_up(-x)
def ceil32(x):
    f=f32(x)
    return next_up(f) if f<x else f
def floor32(x):
    f=f32(x)
    return next_down(f) if f>x else f
checked=bad=old_bad=0
for row in result['boxes']:
    name,axis=row['box'],row['axis']
    origin=boxes[name][0][axis]
    dim=boxes[name][1][axis]
    lo=ceil32(origin);hi=floor32(origin+1.5*(dim-1))
    origin2=origin*2;base_origin=math.floor(origin2);origin_fraction=origin2-base_origin
    t1=ceil32(origin_fraction+.5);t2=ceil32(origin_fraction-.5)
    assert [lo,hi,t1,t2]==[row['constants'][key] for key in
      ('lowFloat32','highFloat32','thresholdRem1Float32','thresholdRem2Float32')]
    local_bad=local_old=0
    for f in samples[f'{name}_{axis}']:
        p=float(f)
        q=(p-origin)/1.5
        inside=0<=q<=dim-1
        expected=math.floor(q+.5)
        u=f32(p*2);whole=math.floor(u);fraction=f32(u-f32(whole))
        delta=whole-base_origin;base=delta//3;rem=delta-3*base
        actual=base+int((rem==1 and fraction>=t1) or (rem==2 and fraction>=t2))
        new_inside=lo<=p<=hi
        if inside!=new_inside or (inside and actual!=expected): local_bad+=1
        old_q=f32(f32(p-f32(origin))/1.5)
        old_inside=0<=old_q<=dim-1
        old=math.floor(f32(old_q+.5))
        if old_inside!=inside or (inside and old!=expected): local_old+=1
        checked+=1
    assert local_bad==row['mismatches'] and local_old==row['oldFormulaMismatches']
    bad+=local_bad;old_bad+=local_old
assert checked==result['pointsByAxis'] and bad==result['mismatches'] and old_bad==result['oldFormulaMismatches']
assert bad==0 and old_bad>0
out={'passed':True,'pointsByAxis':checked,'mismatches':bad,'oldFormulaMismatches':old_bad,
     'samplesSha256':result['samplesSha256'],
     'scope':'Reconstrucción escalar de las muestras; no prueba todas las posiciones ni la GPU.'}
print(json.dumps(out,indent=2,ensure_ascii=False))
