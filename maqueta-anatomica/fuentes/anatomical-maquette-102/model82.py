from model80 import Model as BaseModel
from source80 import *
from partition import query as tetra_query

EXTRA=[
 {'id':91,'name':'Interfaz muscular posterior · E','color':'#e4dec0','group':'fascia'},
 {'id':92,'name':'Tronco y rama hilar izquierda · D/E','color':'#567ecf','group':'vessels'},
 {'id':93,'name':'Reservado, sin geometría','color':'#000000','group':'unused'},
 {'id':94,'name':'Hoja renal posterior parcial · E','color':'#f1cc7b','group':'fascia'},
 {'id':95,'name':'Hoja renal anterior parcial · E','color':'#f1cc7b','group':'fascia'}]

class Model(BaseModel):
 def __init__(self):
  super().__init__();self.fascia=91
  a=np.load(R/'vascular.npz');self.vascular=a['labels'];self.vo=a['origin']
  a=np.load(R/'fascia.npz');self.fx=a['x'];self.fz=a['z'];self.F=a['fields']
  self.types=self.meta['types']+EXTRA
 def leaves(self,p):
  p=np.asarray(p,float);q=(p[...,[0,2]]-[self.fx[0],self.fz[0]])/1.5;dim=np.array([len(self.fx),len(self.fz)]);ok=((q>=0)&(q<dim-1)).all(-1);i=np.floor(np.clip(q,0,dim-2)).astype(int);tx,tz=np.moveaxis(q-i,-1,0);x,z=np.moveaxis(i,-1,0);out=np.zeros(p.shape[:-1],'u2')
  for ch,identifier in [(0,94),(2,95)]:
   a=self.F[z,x,ch];b=self.F[z,x+1,ch];c=self.F[z+1,x,ch];d=self.F[z+1,x+1,ch]
   h=np.where(tx+tz<=1,a+tx*(b-a)+tz*(c-a),d+(1-tx)*(c-d)+(1-tz)*(b-d))
   hit=ok&(self.F[z,x,ch+1]>.5)&(abs(p[...,1]-h)<=.375)
   if np.any(hit&(out!=0)):raise AssertionError('crossing fascial leaves')
   out=np.where(hit,identifier,out)
  return out
 def query(self,p,membranes=False):
  p=np.asarray(p,float)
  if not np.isfinite(p).all():raise ValueError('nonfinite point')
  physical=BaseModel.query(self,p,False);out=BaseModel.query(self,p,membranes)
  vessel=tetra_query(self.vascular,self.vo,p)==92
  leaf=self.leaves(p)
  # Separate explicit annotations; preserve the complete continuous source domain.
  out=np.where(np.isin(physical,[1,2])&(leaf!=0),leaf,out)
  out=np.where(np.isin(physical,[1,2,86])&vessel,92,out)
  return out
