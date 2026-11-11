from pathlib import Path
import json,hashlib,numpy as np,nibabel as nib
from scipy import ndimage as ndi
R=Path(__file__).resolve().parent;OLD=R.parent/'anatomical-maquette-79';CASE=OLD/'source-recovery/s0028'
def save(p,x):p.write_text(json.dumps(x,indent=2,ensure_ascii=False))
def sha(b):return hashlib.sha256(b).hexdigest()
def load(name):return np.asarray(nib.load(CASE/'segmentations'/f'{name}.nii.gz').dataobj,dtype=np.uint8)[::-1].copy()
def setup():
 c=np.load(OLD/'context-volume.npz');return c['labels'],c['origin'],np.asarray(nib.load(CASE/'ct.nii.gz').dataobj,dtype=np.float32)[::-1].copy()
if __name__=='__main__':
 import sys
 sys.path.append('/Library/Frameworks/Python.framework/Versions/3.13/lib/python3.13/site-packages')
 from PIL import Image,ImageDraw,ImageFont
 lab,o,ct=setup();font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18)
 zs=list(range(-170,-69,10));panel=Image.new('RGB',(1200,1000),'#101d28');d=ImageDraw.Draw(panel)
 for n,z in enumerate(zs):
  ix=int(round((z-o[2])/1.5));a=ct[:,:,ix];gray=np.clip((a+160)/400*255,0,255).astype('u1');im=Image.fromarray(gray[:,::-1].T).convert('RGB'); # x right, y up
  # crop x +-120, y -100..70 in source grid
  x0=int((-120-o[0])/1.5);x1=int((120-o[0])/1.5);y0=int((-100-o[1])/1.5);y1=int((70-o[1])/1.5)
  im=im.crop((x0,ct.shape[1]-y1,x1,ct.shape[1]-y0)).resize((400,280));x=(n%3)*400;y=(n//3)*250;panel.paste(im,(x,y+24));d.text((x+10,y+3),f'z={z} mm',fill='white',font=font)
 panel.save(R/'CT-renal-montage.png')
 print('origin',o,'shape',ct.shape)
