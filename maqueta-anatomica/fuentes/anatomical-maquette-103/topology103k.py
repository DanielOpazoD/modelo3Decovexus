from pathlib import Path
import ast,json,sys,numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
R=Path(__file__).resolve().parent;A=R.parent/'anatomical-maquette-102';part=np.load(R/sys.argv[1]);v=part['vertices'];af=part['arcFaces'];ff=part['fasciaFaces'];arc=v[af].astype(float);fas=v[ff].astype(float);G=np.load(A/'ATTACHMENT-GRID102.npz');n=int(G['oldCount']);t=G['triangles'];start=int(G['arcStart']);other=t[n:start,:,:3].astype(float);renal=t[:n,:,:3].astype(float);mod=ast.parse((A/'check-topology100.py').read_text());ns={'np':np,'eps':1e-7};exec(compile(ast.Module(body=[x for x in mod.body if isinstance(x,ast.FunctionDef) and x.name in {'point_in','on_shared','area2','coplanar_overlap','crossing'}],type_ignores=[]),'cross','exec'),ns);cross=ns['crossing'];P=np.array([[0.,0,0],[2,0,0],[0,2,0]]);assert cross(P,np.array([[.5,.5,-1],[.5,.5,1],[1.5,.5,0]]));assert not cross(P,np.array([[0.,0,0],[2,0,0],[1,-1,1]]));assert cross(P,np.array([[.2,.2,0],[1,.2,0],[.2,1,0]]))
def scan(X,Y,same=False):
 lo=Y.min(1);hi=Y.max(1);hit=[];n=0
 for i,t in enumerate(X):
  ids=np.flatnonzero(np.all(hi>=t.min(0)-1e-7,1)&np.all(lo<=t.max(0)+1e-7,1));ids=ids[ids>i]if same else ids;n+=len(ids)
  for j in ids:
   if cross(t,Y[j]):hit.append([i,int(j)])
 return {'hits':len(hit),'pairs':int(n),'examples':hit[:10]}
def near(Y,X):
 lo=X.min((0,1))-1e-7;hi=X.max((0,1))+1e-7;return Y[np.all(Y.max(1)>=lo,1)&np.all(Y.min(1)<=hi,1)]
ae=np.sort(np.vstack([af[:,[0,1]],af[:,[1,2]],af[:,[2,0]]]),1);be=np.sort(np.vstack([ff[:,[0,1]],ff[:,[1,2]],ff[:,[2,0]]]),1);edges=np.vstack([ae,be]);ue,count=np.unique(edges,axis=0,return_counts=True);graph=coo_matrix((np.ones(len(ue)*2),(np.r_[ue[:,0],ue[:,1]],np.r_[ue[:,1],ue[:,0]])),shape=(len(v),len(v))).tocsr();nc,_=connected_components(graph,directed=False);out={'sharedEdges':len(set(map(tuple,ae))&set(map(tuple,be))),'components':int(nc),'nonManifoldEdges':int((count>2).sum()),'cases':{},'negativeCrossingDetected':True,'negativeSharedEdgeAccepted':True,'negativeCoplanarOverlapDetected':True,'scope':'triangle mid-surface floating point; not total thickness or external anatomy'}
for name,X,Y,same in [('arc-v-fascia',arc,fas,False),('arc-self',arc,arc,True),('fascia-self',fas,fas,True),('fascia-v-renal',fas,near(renal,fas),False),('fascia-v-previous',fas,near(other,fas),False),('arc-v-previous',arc,near(other,arc),False)]:
 out['cases'][name]=scan(X,Y,same);print(name,out['cases'][name],flush=True)
out['passed']=nc==1 and not out['nonManifoldEdges'] and all(z['hits']==0 for z in out['cases'].values());(R/'TOPOLOGY103K.json').write_text(json.dumps(out,indent=2)+'\n');print('shared',out['sharedEdges'],'component',nc,'passed',out['passed'])
