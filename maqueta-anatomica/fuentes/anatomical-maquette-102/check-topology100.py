"""Mesh incidence and triangle-surface crossings; float tolerances, not exact predicates."""
from pathlib import Path
import json,numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
R=Path(__file__).resolve().parent
eps=1e-7

def point_in(p,t):
    a,b,c=t;ab=b-a;ac=c-a;v=p-a
    x=np.dot(v,ab);y=np.dot(v,ac);aa=np.dot(ab,ab);bb=np.dot(ab,ac);cc=np.dot(ac,ac);det=aa*cc-bb*bb
    if abs(det)<1e-14:return False
    u=(cc*x-bb*y)/det;w=(aa*y-bb*x)/det
    return u>=-eps and w>=-eps and u+w<=1+eps

def on_shared(p,shared):
    if any(np.linalg.norm(p-q)<1e-5 for q in shared):return True
    if len(shared)<2:return False
    a,b=shared[:2];v=b-a;t=np.clip(np.dot(p-a,v)/np.dot(v,v),0,1)
    return np.linalg.norm(p-(a+t*v))<1e-5

def area2(poly):
    if len(poly)<3:return 0.
    p=np.asarray(poly);return abs(np.sum(p[:,0]*np.roll(p[:,1],-1)-p[:,1]*np.roll(p[:,0],-1)))/2

def coplanar_overlap(a,b,n):
    # Polygon clipping computes overlapping area; boundary-only contact has zero area.
    i=np.argmax(abs(n));a=np.delete(a,i,axis=1);b=np.delete(b,i,axis=1)
    cross=lambda u,v:u[0]*v[1]-u[1]*v[0]
    orient=np.sign(cross(b[1]-b[0],b[2]-b[0]));poly=list(a)
    for j in range(3):
        p,q=b[j],b[(j+1)%3];out=[]
        if not poly:break
        for s,t in zip(poly,poly[1:]+poly[:1]):
            ds=orient*cross(q-p,s-p);dt=orient*cross(q-p,t-p);ins=ds>=-eps;intt=dt>=-eps
            if ins!=intt:
                z=ds/(ds-dt);out.append(s+z*(t-s))
            if intt:out.append(t)
        poly=out
    return area2(poly)>1e-9

def crossing(a,b):
    shared=[x for x in a if any(np.linalg.norm(x-y)<1e-6 for y in b)]
    na=np.cross(a[1]-a[0],a[2]-a[0]);nb=np.cross(b[1]-b[0],b[2]-b[0]);na/=np.linalg.norm(na);nb/=np.linalg.norm(nb)
    da=np.dot(a-b[0],nb);db=np.dot(b-a[0],na)
    if (da.min()>eps or da.max()<-eps or db.min()>eps or db.max()<-eps):return False
    if np.max(abs(da))<eps and np.max(abs(db))<eps:return coplanar_overlap(a,b,na)
    for tri,other,dist in ((a,b,da),(b,a,db)):
        for i,j in ((0,1),(1,2),(2,0)):
            x,y=dist[i],dist[j]
            if (x>eps and y>eps) or (x<-eps and y<-eps):continue
            if abs(x-y)<1e-14:continue
            u=x/(x-y)
            if -eps<=u<=1+eps:
                p=tri[i]+u*(tri[j]-tri[i])
                if point_in(p,other) and not on_shared(p,shared):return True
    return False

negA=np.array([[0.,0,0],[2,0,0],[0,2,0]]);negB=np.array([[.5,.5,-1],[.5,.5,1],[1.5,.5,0]])
assert crossing(negA,negB)
assert not crossing(negA,np.array([[0.,0,0],[2,0,0],[1,-1,1]]))
assert crossing(negA,np.array([[.2,.2,0],[1,.2,0],[.2,1,0]]))
fas=np.load(R/'FASCIA100-left.npz');a=np.load(R/'PART99-left-clear.npz');fv=fas['vertices'];ff=fas['faces'];av=a['vertices'];af=a['faces'];jf=a['joinFaces'];parts=[fv[ff].astype(float),av[af].astype(float),av[jf].astype(float)]
tri=np.concatenate(parts);v,inv=np.unique(tri.reshape(-1,3),axis=0,return_inverse=True);f=inv.reshape(-1,3);e=np.sort(np.vstack((f[:,[0,1]],f[:,[1,2]],f[:,[2,0]])),axis=1);ue,count=np.unique(e,axis=0,return_counts=True)
graph=coo_matrix((np.ones(2*len(ue)),(np.r_[ue[:,0],ue[:,1]],np.r_[ue[:,1],ue[:,0]])),shape=(len(v),len(v))).tocsr();ncomp,_=connected_components(graph,directed=False)
areas=np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)
mins=[x.min(1) for x in parts];maxs=[x.max(1) for x in parts];overlap=[];checked=0
for u,w in ((0,1),(0,2),(1,2),(1,1),(2,2)):
    for i,t in enumerate(parts[u]):
        hit=np.flatnonzero(np.all(maxs[w]>=mins[u][i]-eps,axis=1)&np.all(mins[w]<=maxs[u][i]+eps,axis=1))
        if u==w:hit=hit[hit>i]
        for j in hit:
            checked+=1
            if crossing(t,parts[w][j]):overlap.append([u,i,w,int(j)])
report={'components':int(ncomp),'faces':len(f),'vertices':len(v),'boundaryEdges':int((count==1).sum()),'nonmanifoldEdges':int((count>2).sum()),'minDoubleAreaMm2':float(areas.min()),'aabbCandidatePairs':int(checked),'interiorCrossings':len(overlap),'firstCrossings':overlap[:20],'negativeCrossingDetected':True,'negativeSharedEdgeAccepted':True,'negativeCoplanarOverlapDetected':True,'toleranceMm':eps,'scope':'triangle mid-surfaces; floating point; does not prove thickened-volume separation or anatomy'}
(R/'TOPOLOGY100.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
