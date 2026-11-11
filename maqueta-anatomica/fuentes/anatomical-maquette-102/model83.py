from model82 import Model as BeforeModel
from source80 import *

class Model(BeforeModel):
 def __init__(self):
  super().__init__()
  a=np.load(R/'NETWORK-GRID.npz');self.S=a['segments'];self.spans=a['spans'];self.indices=a['indices'];self.go=a['origin'];self.gd=a['dims']
  a=np.load(R/'BRIDGE-GRID.npz');self.T=a['triangles'];self.bo=a['origin'];self.bd=a['dims'];self.bsp=a['spans'];self.bi=a['indices']
  a=np.load(R/'lateral-fascia.npz');self.J=a['fields'];self.jy=a['y'];self.jz=a['z']
  self.types+= [{'id':96,'name':'Arborización arterial intrarrenal · E','color':'#e36659','group':'vessels'}, {'id':97,'name':'Pared arterial estimada · E','color':'#f19a86','group':'vessels'}, {'id':98,'name':'Arborización venosa intrarrenal · E','color':'#4e76d2','group':'vessels'}, {'id':99,'name':'Pared venosa estimada · E','color':'#96b2ed','group':'vessels'}, {'id':100,'name':'Continuidad fascial lateral · E','color':'#f1cc7b','group':'fascia'}, {'id':101,'name':'Pliegue de unión fascial posterior · E','color':'#f1cc7b','group':'fascia'}]
 def distances(self,p):
  p=np.asarray(p,float);shape=p.shape[:-1];p=p.reshape(-1,3);q=np.floor((p-self.go)/4).astype(int);ok=((q>=0)&(q<self.gd)).all(1);q=np.clip(q,0,self.gd-1);idx=q[:,0]+self.gd[0]*(q[:,1]+self.gd[1]*q[:,2]);span=self.spans[idx];out=np.full((len(p),2),np.inf)
  for k in range(int(span[:,1].max(initial=0))):
   active=ok&(span[:,1]>k);ii=np.flatnonzero(active);s=self.S[self.indices[span[active,0]+k]];a=s[:,0,:3].astype(float);b=s[:,1,:3].astype(float);ab=b-a;t=np.clip(((p[ii]-a)*ab).sum(1)/(ab*ab).sum(1),0,1);rad=s[:,0,3]+t*(s[:,1,3]-s[:,0,3]);dist=np.linalg.norm(p[ii]-a-t[:,None]*ab,axis=1)-rad;family=s[:,2,0].astype(int);out[ii,family]=np.minimum(out[ii,family],dist)
  return out.reshape(*shape,2)
 def lateral(self,p):
  p=np.asarray(p,float);q=(p[...,[1,2]]-[self.jy[0],self.jz[0]])/.75;dim=np.array([len(self.jy),len(self.jz)]);valid=((q>=0)&(q<dim-1)).all(-1);i=np.floor(np.clip(q,0,dim-2)).astype(int);ty,tz=np.moveaxis(q-i,-1,0);y,z=np.moveaxis(i,-1,0);hit=np.zeros(p.shape[:-1],bool)
  for ch in[0,2]:
   a=self.J[z,y,ch];b=self.J[z,y+1,ch];c=self.J[z+1,y,ch];d=self.J[z+1,y+1,ch];h=np.where(ty+tz<=1,a+ty*(b-a)+tz*(c-a),d+(1-ty)*(c-d)+(1-tz)*(b-d));hit|=valid&(self.J[z,y,ch+1]>.5)&(abs(p[...,0]-h)<=.375)
  return hit
 def bridgeDistances(self,p):
  p=np.asarray(p,float);shape=p.shape[:-1];p=p.reshape(-1,3);q=np.floor((p-self.bo)/1.5).astype(int);ok=((q>=0)&(q<self.bd)).all(1);keep=np.flatnonzero(ok);full=np.full(len(p),np.inf)
  if not len(keep):return full.reshape(shape)
  p=p[keep];q=q[keep];ok=np.ones(len(p),bool);idx=q[:,0]+self.bd[0]*(q[:,1]+self.bd[1]*q[:,2]);sp=self.bsp[idx];out=np.full(len(p),np.inf)
  for k in range(int(sp[:,1].max(initial=0))):
   active=ok&(sp[:,1]>k);ii=np.flatnonzero(active);t=self.T[self.bi[sp[active,0]+k]].astype(float);a=t[:,0];ab=t[:,1]-a;ac=t[:,2]-a;v=p[ii]-a;n=np.cross(ab,ac);nn=(n*n).sum(1);h=(v*n).sum(1);proj=v-n*(h/nn)[:,None];aa=(ab*ab).sum(1);bb=(ab*ac).sum(1);cc=(ac*ac).sum(1);x=(proj*ab).sum(1);y=(proj*ac).sum(1);det=aa*cc-bb*bb;u=(cc*x-bb*y)/det;w=(aa*y-bb*x)/det;inside=(u>=0)&(w>=0)&(u+w<=1);dist=np.where(inside,abs(h)/np.sqrt(nn),np.inf)
   for e,f in[(0,1),(1,2),(2,0)]:
    dd=t[:,f]-t[:,e];tt=np.clip(((p[ii]-t[:,e])*dd).sum(1)/(dd*dd).sum(1),0,1);dist=np.minimum(dist,np.linalg.norm(p[ii]-t[:,e]-tt[:,None]*dd,axis=1))
   out[ii]=np.minimum(out[ii],dist)
  full[keep]=out;return full.reshape(shape)
 def query(self,p,membranes=False):
  p=np.asarray(p,float)
  if not np.isfinite(p).all():raise ValueError('nonfinite point')
  base=BeforeModel.query(self,p,membranes);physical=BeforeModel.query(self,p,False);out=np.where((self.bridgeDistances(p)<=.375)&np.isin(physical,[1,2]),101,base);out=np.where(self.lateral(p)&np.isin(physical,[1,2]),100,out)
  d=self.distances(p);artery=d[...,0]<=.12;vein=d[...,1]<=.12
  # Geometry validation rejects intersections; priority is not a repair for them.
  permitted=np.isin(physical,[1,2,80,82,84,86]);out=np.where(permitted&artery,np.where(d[...,0]<=0,96,97),out);out=np.where(permitted&vein,np.where(d[...,1]<=0,98,99),out)
  # The existing parent lumen retains its material, without an internal end cap.
  return out
