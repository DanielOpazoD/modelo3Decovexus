from pathlib import Path
import json,numpy as np
R=Path(__file__).resolve().parent;A=R.parent/'anatomical-maquette-102';g=np.load(A/'ATTACHMENT-GRID102.npz');T0=g['triangles'];sp=g['spans'];oi=g['indices'];origin=g['origin'];dims=g['dims'];fasciaEnd=int(g['oldCount']);p=np.load(R/'PART103K-PILOT.npz');new=p['vertices'][p['newFasciaFaces']];add=np.zeros((len(new),3,4),'f4');add[:,:,:3]=new;add[:,0,3]=165;add[:,1,3]=165;T=np.concatenate([T0,add]);radius=.375;lo=np.floor((new.min(1)-radius-origin)/1.5).astype(int);hi=np.floor((new.max(1)+radius-origin)/1.5).astype(int);assert (lo>=0).all() and (hi<dims).all();cells={}
for j in range(len(new)):
 id=len(T0)+j
 for z in range(lo[j,2],hi[j,2]+1):
  for y in range(lo[j,1],hi[j,1]+1):
   for x in range(lo[j,0],hi[j,0]+1):cells.setdefault(int(x+dims[0]*(y+dims[1]*z)),[]).append(id)
added=np.zeros(len(sp),'u4')
for cell,ls in cells.items():ls.sort();added[cell]=len(ls)
newcount=sp[:,1]+added;starts=np.cumsum(newcount,dtype='u8')-newcount;outsp=np.column_stack((starts,newcount)).astype('u4');out=np.empty(int(newcount.sum()),'u4');oldcell=np.repeat(np.arange(len(sp),dtype='u4'),sp[:,1]);pos=np.arange(len(oi));dest=outsp[oldcell,0].astype('i8')+pos-sp[oldcell,0];out[dest]=oi
for cell,ls in cells.items():
 k=int(outsp[cell,0]+sp[cell,1]);out[k:k+len(ls)]=ls
assert np.array_equal(out[dest],oi);oc=np.repeat(np.arange(len(outsp),dtype='u4'),outsp[:,1]);assert np.all(np.diff(out.astype('i8'))[oc[1:]==oc[:-1]]>=0);fc=np.bincount(oc[out<fasciaEnd],minlength=len(sp)).astype('u4');assert newcount.max()<65536 and fc.max()<65536;packed=outsp.copy();packed[:,1]=newcount|(fc<<np.uint32(16));assert np.array_equal(packed[:,1]>>np.uint32(16),fc);assert np.array_equal(packed[:,1]&np.uint32(65535),newcount);bad=packed.copy();j=int(np.flatnonzero(fc>0)[0]);bad[j,1]^=np.uint32(1<<16);assert not np.array_equal(bad[:,1]>>np.uint32(16),fc)
np.savez_compressed(R/'ATTACHMENT-GRID103K.npz',triangles=T,origin=origin,dims=dims,spans=outsp,indices=out,oldCount=fasciaEnd,arcStart=int(g['arcStart']),sheetStart=int(g['sheetStart']));np.save(R/'PACKED-SPANS103K.npy',packed)
row={'baseTriangles':len(T0),'newTriangles':len(new),'allTriangles':len(T),'oldTrianglesUnchanged':bool(np.array_equal(T[:len(T0)],T0)),'oldReferencesPreserved':len(oi),'newReferences':len(out),'newCellEntries':int(added.sum()),'perCellSorted':True,'packedReconstructsCounts':True,'negativeCorruptCountDetected':True,'scope':'logical arrays; not RSS or elapsed GPU'};(R/'GRID103K.json').write_text(json.dumps(row,indent=2)+'\n');print(json.dumps(row))
