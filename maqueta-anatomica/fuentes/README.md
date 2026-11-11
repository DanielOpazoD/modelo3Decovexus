# Fuentes para continuar la maqueta

Se incluyen los campos y mallas utilizados por la iteración 103, el índice geométrico de 102 y scripts seleccionados. Las carpetas `anatomical-maquette-102` y `anatomical-maquette-103` preservan la relación de rutas de los scripts. Para materializar el campo previo dividido:

```bash
python3 maqueta-anatomica/verificar-datos.py --reconstruir-fuentes
```

Se reconstruyen el campo y los datos de la maqueta base 102; ambos se ignoran en Git para no duplicar los fragmentos. Copia estas carpetas a un directorio de trabajo antes de ejecutar los scripts: algunos escriben resultados con los mismos nombres que los originales incluidos. Los scripts geométricos requieren Python con NumPy, SciPy y NiBabel; el entorno anterior usó Python 3.13, NumPy 2.5.3, SciPy 1.18.1 y NiBabel 5.4.2. En una copia temporal se reprodujeron la construcción, la topología y las muestras reservadas; los arrays de la malla coincidieron exactamente (`../evidencia/REPRO-FUENTES.json`). Algunas auditorías históricas también necesitan datos que no se redistribuyen, en especial máscaras originales no disponibles y el archivo completo de evidencia. No presentar estos scripts seleccionados como reproducción completa de todas las iteraciones anteriores.

La geometría 103 se puede estudiar directamente en `anatomical-maquette-103/PART103K-PILOT.npz`, `FIELDS103G.npz`, `ATTACHMENT-GRID103K.npz` y los dos visores. Los atlas ejecutables y sus hashes están en `../datos/`; 102 y 103 comparten el atlas base y 103 aplica un parche de valores exactos. Los scripts `visor-*.js` contienen los clasificadores y las superficies del visor.
