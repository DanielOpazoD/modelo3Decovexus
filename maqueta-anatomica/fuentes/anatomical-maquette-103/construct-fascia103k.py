from pathlib import Path
import sys,numpy as np,json
from scipy.ndimage import map_coordinates
R=Path(__file__).resolve().parent;A=R.parent/'anatomical-maquette-102';sys.path.insert(0,str(A));from model83 import Model
p=np.load(A/'PART102-COMBINED.npz');v=p['vertices'].astype(float);af=p['arcFaces'];old=p['fasciaFaces'];arc=v[:861].reshape(-1,7,3);start,end=42,103;verts=list(v);newinds={};
edges=arc[:,0];length=np.linalg.norm(np.diff(edges,axis=0),axis=1);widths=np.zeros(end-start+1)
for i in range(start+1,end):
 a=edges[i]-edges[i-1];b=edges[i+1]-edges[i];c=edges[i+1]-edges[i-1];radius=np.linalg.norm(a)*np.linalg.norm(b)*np.linalg.norm(c)/max(2*np.linalg.norm(np.cross(a,b)),1e-12);widths[i-start]=min(.85*np.sin(np.pi*(i-start)/(end-start)),.25*radius)
for i in range(1,len(widths)):widths[i]=min(widths[i],widths[i-1]+.4*length[start+i-1])
for i in range(len(widths)-2,-1,-1):widths[i]=min(widths[i],widths[i+1]+.4*length[start+i])
for i in range(start+1,end):
 w=widths[i-start];edge=edges[i];t=edges[i+1]-edges[i-1];t/=np.linalg.norm(t);d=edge-arc[i,1];d-=t*np.dot(t,d);d/=np.linalg.norm(d);newinds[(i,1)]=len(verts);verts.append(edge+d*min(.2,w/3));newinds[(i,2)]=len(verts);verts.append(edge+d*w)
def vid(i,k):
 if k==0 or i in [start,end]:return i*7
 return newinds[(i,k)]
faces=[]
for i in range(start,end):
 for k in range(2):
  if i==start:faces.append([vid(i,0),vid(i+1,k),vid(i+1,k+1)])
  elif i+1==end:faces.append([vid(i,k),vid(i+1,0),vid(i,k+1)])
  else:faces.extend([[vid(i,k),vid(i+1,k),vid(i,k+1)],[vid(i,k+1),vid(i+1,k),vid(i+1,k+1)]])
v=np.asarray(verts,'f4');faces=np.asarray(faces,'u4');assert np.array_equal(v[:len(p['vertices'])],p['vertices']);t=v[faces].astype(float);n=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]);area=np.linalg.norm(n,axis=1);assert (area>1e-8).all();n/=area[:,None];rng=np.random.default_rng(np.random.SeedSequence([10301,165]));w=rng.dirichlet([1,1,1],size=(len(faces),8));mid=np.einsum('tvc,tsv->tsc',t,w);q=np.concatenate([(mid+n[:,None,:]*x).reshape(-1,3) for x in [-.375,0,.375]])
F=np.load(A/'FIELDS98.npz');B=np.load(R/'FIELDS103G.npz');g=np.load(A/'FASCIA101-ONLY-GRID.npz');nt=np.load(A/'NETWORK-GRID.npz');m=object.__new__(Model);m.T=g['triangles'];m.bo=g['origin'];m.bd=g['dims'];m.bsp=g['spans'];m.bi=g['indices'];m.S=nt['segments'];m.spans=nt['spans'];m.indices=nt['indices'];m.go=nt['origin'];m.gd=nt['dims'];checks={};anchor=arc[-1].mean(0);near=np.linalg.norm(q-anchor,axis=1)<3
for k in ['organs','bone','psoas-model-right','QL-model-right']:
 x=map_coordinates(F[k],((q-F['origin'])/1.5).T,order=1,mode='constant',cval=-100,prefilter=False);bad=((x<0)&~near)|((x<-.5)&near) if k=='bone' else x<0;checks[k]={'bad':int(bad.sum()),'minimum':float(x.min()),'nearAnchor':int(near.sum())}
x=map_coordinates(B['qlNew'],((q-B['qlOrigin'])/1.5)[:,::-1].T,order=1,mode='constant',cval=100,prefilter=False);checks['QL-new']={'bad':int((x<0).sum()),'minimum':float(x.min())};x=m.bridgeDistances(q);checks['renalFascia']={'bad':int((x<=.375).sum()),'minimum':float(x.min())if np.isfinite(x).any()else None};x=m.distances(q)
for j,k in enumerate(['artery','vein']):checks[k]={'bad':int((x[:,j]<=.12).sum()),'minimum':float(x[:,j].min())if np.isfinite(x[:,j]).any()else None}
np.savez_compressed(R/'PART103K-PILOT.npz',vertices=v,arcFaces=af,fasciaFaces=np.vstack([old,faces]),oldFasciaFaces=old,newFasciaFaces=faces,anchors=p['anchors']);np.savez_compressed(R/'CONSTRUCTION-SAMPLES103K.npz',samples=q);out={'seed':10301,'startRow':start,'endRow':end,'newFaces':len(faces),'previousFaces':len(old),'samples':len(q),'maxNominalWidthMm':.85,'actualMaxWidthMm':float(widths.max()),'actualMinInteriorWidthMm':float(widths[1:-1].min()),'minDoubleAreaMm2':float(area.min()),'nearRibAnchorSamples':int(near.sum()),'checks':checks,'passed':all(z['bad']==0 for z in checks.values()),'scope':'construction samples and derived fields; not source anatomy or proof over thickened volume'};(R/'FASCIA103K-CONSTRUCTION.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
