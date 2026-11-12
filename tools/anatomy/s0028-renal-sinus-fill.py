"""Contenido no subclasificado del seno renal s0028, para `install-s0028-renal-interior.ts`.

El exportador `s0028-renal-interior.py` deja U los vóxeles del seno que no son grasa ni luz del colector: vasos del hilio
y sus interfaces. En ecografía ese conjunto es el complejo ecogénico del seno. Este paso lista, por riñón, los vóxeles de
la componente del seno (derivada del propio TAC) que quedaron U, sin la banda de la boca hiliar, que sigue U porque
depende de la regla de cierre. El compartimento es D; tratarlo como material del seno es una hipótesis E. No lee HU.

    python -I tools/anatomy/s0028-renal-sinus-fill.py <carpeta del exportador>

Escribe `sinus-fill.json`: índices lineales (xyz, z rápida) como diferencias sucesivas, por lado.
"""
import json
from pathlib import Path
import sys

import numpy as np

folder = Path(sys.argv[1])
out = {}
for side in ('right', 'left'):
    review = np.load(folder/f'review-{side}.npz')
    fill = review['sinus'] & ~review['band'] & (review['labels'] == 0)
    index = np.flatnonzero(fill.ravel(order='C'))
    out[side] = {'dimensions': list(fill.shape), 'count': int(index.size), 'deltas': np.diff(index, prepend=0).tolist()}
(folder/'sinus-fill.json').write_text(json.dumps(out, separators=(',', ':')))
print({side: row['count'] for side, row in out.items()})
