from source80 import *
from partition import query as tetra_query
class Model:
 def __init__(self):
  a=np.load(R/'materials.npz');self.v=a['labels'];self.o=a['origin'];self.meta=json.loads((R/'MATERIALS.json').read_text());h=np.load(OLD/'height79.npz');self.x=h['x'];self.y=h['y'];self.H=h['H'];self.C=h['cells'];self.di=next(t['id']for t in self.meta['types']if t['group']=='diaphragm');self.mi=[19,20]+[t['id']for t in self.meta['types']if t['group']=='posterior'];self.fascia=len(self.meta['types']);self.base=np.load(R.parent/'anatomical-maquette-80/materials.npz')['labels']
 def diaphragm(self,p):
  p=np.asarray(p,float);q=(p[...,:2]-[self.x[0],self.y[0]])/[self.x[1]-self.x[0],self.y[1]-self.y[0]];dim=np.array([len(self.x),len(self.y)]);ok=((q>=0)&(q<dim-1)).all(-1);i=np.floor(np.clip(q,0,dim-2)).astype(int);tx,ty=np.moveaxis(q-i,-1,0);x,y=np.moveaxis(i,-1,0);H=self.H;hh=np.where(tx+ty<=1,H[y,x]+tx*(H[y,x+1]-H[y,x])+ty*(H[y+1,x]-H[y,x]),H[y+1,x+1]+(1-tx)*(H[y+1,x]-H[y+1,x+1])+(1-ty)*(H[y,x+1]-H[y+1,x+1]));return ok&self.C[y,x]&(abs(p[...,2]-hh)<=.75)
 def solid(self,p):
  original=tetra_query(self.base,self.o,p);candidate=tetra_query(self.v,self.o,p)
  mutable=np.isin(original,[1,2,88,89])&np.isin(candidate,[1,2,88,89])
  return np.where(mutable,candidate,original)
 def query(self,p,membranes=False):
  p=np.asarray(p,float)
  if not np.isfinite(p).all():raise ValueError('nonfinite point')
  lab=self.solid(p);lab=np.where(self.diaphragm(p),self.di,lab)
  if membranes:
   # Display convention for a zero-thickness shared boundary: sample its anterior
   # contact on the muscle side. Width0.5mm is display, NOT fascial anatomy.
   ahead=p+[0,.5,0];other=self.solid(ahead);on=np.isin(lab,self.mi)&np.isin(other,[1,2]);lab=np.where(on,self.fascia,lab)
  return lab
