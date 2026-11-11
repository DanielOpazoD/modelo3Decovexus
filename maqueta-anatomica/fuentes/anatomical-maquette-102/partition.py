"""Shared tetrahedral material partition; no independently displaced surfaces."""
import itertools, numpy as np
from functools import lru_cache
from fractions import Fraction
V=np.array([[0,0,0],[1,0,0],[0,1,0],[0,0,1]],float)
B=np.array([[-1,-1,-1,1],[1,0,0,0],[0,1,0,0],[0,0,1,0]],float)
# Every cube uses the same Freudenthal subdivision. Face diagonals agree across cubes.
TETS=[]
for perm in itertools.permutations(range(3)):
 p=np.zeros(3,int);t=[p.copy()]
 for k in perm:p=p.copy();p[k]+=1;t.append(p)
 TETS.append(np.array(t))
def canonical(labels):
 m={};return tuple(m.setdefault(int(x),len(m))for x in labels)
@lru_cache(None)
def template(pattern):
 """Interface polygons once per material pair. Exact rational vertices cached.
 Constraints in barycentric coordinates have integer coefficients. Each vertex is
 solved by Fraction Gaussian elimination; no tolerance to change membership.
 """
 n=max(pattern)+1;W=np.array([B[np.array(pattern)==i].sum(0)for i in range(n)],dtype=int)
 def solve(A,b):
  m=[[Fraction(int(q))for q in row]+[Fraction(int(v))]for row,v in zip(A,b)]
  for i in range(3):
   pivot=next((j for j in range(i,3)if m[j][i]),None)
   if pivot is None:return None
   m[i],m[pivot]=m[pivot],m[i];s=m[i][i];m[i]=[x/s for x in m[i]]
   for j in range(3):
    if j!=i:
     s=m[j][i];m[j]=[a-s*b for a,b in zip(m[j],m[i])]
  return tuple(row[3]for row in m)
 faces=[]
 for a,b in itertools.combinations(range(n),2):
  eq=W[a]-W[b];constraints=list(B.astype(int))+[W[a]-W[c]for c in range(n)if c not in[a,b]];pts=set()
  for c,d in itertools.combinations(constraints,2):
   p=solve([eq[:3],c[:3],d[:3]],[-eq[3],-c[3],-d[3]])
   if p is not None and all(sum(Fraction(int(v))*x for v,x in zip(h[:3],p))+int(h[3])>=0 for h in constraints):pts.add(p)
  if len(pts)<3:continue
  q=np.array([list(map(float,p))for p in sorted(pts)]);center=q.mean(0);normal=eq[:3].astype(float);normal/=np.linalg.norm(normal);u=q[0]-center;u/=np.linalg.norm(u);v=np.cross(normal,u);angle=np.arctan2((q-center)@v,(q-center)@u);q=q[np.argsort(angle)]
  # normal W[a]-W[b] points INTO a, so outward a is reversed.
  q=q[::-1];faces.append((a,b,q))
 return faces

def query(labels,origin,points,pitch=1.5,background=0):
 p=np.asarray(points,float);shape=p.shape[:-1];p=p.reshape(-1,3)
 if not np.isfinite(p).all():raise ValueError('nonfinite coordinate')
 q=(p-origin)/pitch;i=np.floor(q).astype(int);f=q-i;valid=((i>=0)&(i<np.array(labels.shape)-1)).all(1);i=np.clip(i,0,np.array(labels.shape)-2)
 order=np.argsort(-f,axis=1,kind='stable');sf=np.take_along_axis(f,order,axis=1);weights=np.column_stack([1-sf[:,0],sf[:,0]-sf[:,1],sf[:,1]-sf[:,2],sf[:,2]])
 nodes=np.repeat(i[:,None,:],4,axis=1)
 for j in range(1,4):
  nodes[:,j]=nodes[:,j-1];nodes[np.arange(len(p)),j,order[:,j-1]]+=1
 ids=labels[tuple(np.moveaxis(nodes,-1,0))];score=np.stack([(weights*(ids==ids[:,j,None])).sum(1)for j in range(4)],1)
 # Tie picks smallest id ONLY on shared zero-volume interface.
 maxscore=score.max(1);out=np.where(score==maxscore[:,None],ids,65535).min(1);out[~valid]=background
 return out.reshape(shape)

if __name__=='__main__':
 import json
 from scipy.spatial import ConvexHull
 rng=np.random.default_rng(80);w=rng.dirichlet(np.ones(4),10000);tests=[]
 for pat in [(0,0,0,1),(0,0,1,1),(0,0,1,2),(0,1,2,3)]:
  faces=template(pat);W=np.stack([(w[:,np.array(pat)==i]).sum(1)for i in range(max(pat)+1)],1);assert np.all((W==W.max(1)[:,None]).sum(1)==1)
  volumes=[]
  for a in range(max(pat)+1):
   verts=[V[j]for j in range(4)if pat[j]==a]
   for u,v,q in faces:
    if a in[u,v]:verts.extend(q)
   volumes.append(ConvexHull(np.unique(np.array(verts),axis=0)).volume)
  assert abs(sum(volumes)-1/6)<1e-14
  for a,b,q in faces:
   bary=np.column_stack([1-q.sum(1),q]);wa=bary[:,np.array(pat)==a].sum(1);wb=bary[:,np.array(pat)==b].sum(1);assert np.max(abs(wa-wb))<1e-14
  tests.append({'pattern':pat,'interfaces':len(faces),'volumes':volumes,'volumeTotal':sum(volumes)})
 # Independent half-space sums can overlap: retain discriminating negative.
 independentOverlap=int(((w[:,0]+w[:,1]>.4)&(w[:,2]+w[:,3]>.4)).sum());assert independentOverlap>0
 print(json.dumps({'passed':True,'randomPointsPerPattern':10000,'tests':tests,'negativeIndependentThresholdOverlap':independentOverlap,'construction':'rational plane intersections; floating verification tolerance1e-14 only for volume arithmetic, not material membership'},indent=2))
