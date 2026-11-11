# Estado de la rama renal

Esta rama conserva, sin modificar sus bytes, los 22 archivos versionados con cambios y cuatro archivos nuevos que estaban en el checkout aislado `codex/renal-network-73`, sobre el commit de origen `adaf67255268f021b06575d2663a26c881e4f663`. `SNAPSHOT.json` registra los hashes de los 26 archivos. El `main` de este repositorio añade el visor portable y la guía de continuidad; esta rama parte de ese `main` y añade la instantánea renal.

Comprobaciones nuevas de esta copia: `npm run typecheck` aprobado y `npx vitest run src/validation/renalNetwork.test.ts src/validation/renalSinus.test.ts src/validation/vascularBranches.test.ts src/anatomy/gpu/tubeSegmentGrid.test.ts` aprobado (cuatro archivos, 22 pruebas). `git diff --check` también pasó. No se volvió a ejecutar el check completo ni se ha verificado una CI de este nuevo commit.

La evidencia local previa descrita en `RESULTS.md` y `CLOSURE.json` es más amplia, pero el paquete conserva únicamente los originales materializados enumerados en `MANIFEST.json`. Algunos otros archivos del archivo histórico no estaban descargados. Mantener la rama como trabajo en curso hasta comprobar el head final, revisar los límites de las interfaces CPU/GPU y completar las comprobaciones que correspondan.
