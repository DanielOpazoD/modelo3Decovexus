# Corte a s0028: qué está listo, qué falta y en qué orden

Actualizado: 2026-11-15. El corte deja s0028 como la única anatomía y retira `default` y `legacy` (decisión 340, `docs/REGLAS.md`). Su
condición es que el responsable revise las láminas de las relaciones con el TAC. Revisión preparada en la página
[Revisión del corte s0028](https://claude.ai/artifact/VAVUYUcufbFQnwXk9TXZcQ); la PR que cambia la persona por defecto (66) espera su
respuesta.

## Listo

| Qué                   | Estado                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Relaciones con su TAC | 21 de 21, medidas sobre main el 15-11 (`relaciones-tac.md`); láminas axial, coronal y sagital                |
| Ventanas              | ocho con pose propia (decisiones 381–396)                                                                    |
| Cadena del alumno     | el grado de la verdad en los ocho casos; escalas del equipo (PR 58), porta invertida (394), VCI (396)        |
| Paridad TS ↔ GLSL     | `s0028SolidsGpu`, `s0028WallGpu` y `s0028Equivalence` (diez ventanas, 80 000 puntos, 15 caras; 46–59 s/caso) |
| Primer mapa del corte | 4,7–5,2 s tras cargar, antes que la otra persona (6,4 s)                                                     |

## Falta

**Coste.** La regla pide 60 fps con la sonda quieta en cada estado del banco. s0028 da 30–60 (la otra, 60); detalle en
`docs/estado/imagen.md`. Al mover, el contacto ya no es el límite (de 35 a 10 ms por pose, PR 63). Lo que queda es la GPU de la
ecografía (15–23 ms; la otra, 5–7). Saltar las clasificaciones de elevación de B la baja un 30–40 %: en el plano de las ventanas, el
37–66 % de las muestras de s0028 tienen `bd ≤ 3 mm`. La grasa mesentérica y perirrenal y los contenidos digestivos salen todos con
`bd = 0`, porque vienen de máscaras de vóxel sin distancia. Un `bd` que sea cota de verdad (TS = GLSL, imagen idéntica)
necesita la distancia a esas máscaras, que hoy no existe: un dato nuevo (por ejemplo, un radio seguro por celda de 3 mm calculado
offline), con su coste de memoria y descarga. Su techo es moderado: de esas clasificaciones, solo el 52–67 % tienen el mismo tejido
a ±se, así que un `bd` perfecto ahorraría un 16–25 % del cuadro. Ya se probó sin ganancia tomar la distancia al campo fuente más
cercano; la rejilla vascular de 8 mm da un 5–17 % (PR 65).

La palanca grande es abaratar cada clasificación: s0028 lee unos 19 campos fuente por punto y, sin leerlos (experimento que rompe
la imagen, solo para medir), el cuadro baja de 21–23 a 12,6–14 ms. Aprobado por el responsable el 15-11-2026, en curso: un mapa de ocupación por celda de
6 mm que diga qué campos pueden quedar cerca (a menos de un margen mayor que todos sus umbrales) y, con él, no leer los demás: en las
ventanas, solo 1,7–2,3 de los 19 campos quedan a menos de 16 mm de cada muestra, así que caerían casi todas las lecturas. Sería
exacto: la trilineal está acotada por sus nodos, así que «el campo no baja de M en la celda» se calcula sin muestreo. Solo cambia la
GPU (la CPU sigue leyéndolo todo y el gate de equivalencia lo comprueba). Costaría un dato nuevo de unos 360 kB y vigilar los techos
de SwiftShader, que el GLSL de s0028 tiene al 92 %.

**Pruebas.** Inventario de la e2e completa con `E2E_ABDOMEN=s0028` en la CI (PR 64, 15-11, sin los fragmentos 4 y 9): de 170
pruebas pasan 78 y fallan 92.

| Grupo                                          | Fallos | Qué se hace                                                                    |
| ---------------------------------------------- | -----: | ------------------------------------------------------------------------------ |
| Esperaban la pose de la otra persona           |     26 | arreglado: `windowAcquired` y `aortaPulse` usan la persona cargada (PR 67)     |
| Propias de la otra persona                     |     42 | atlas registrado, `legacy` y `?reference=1`: se retiran con ella               |
| Cifras o poses calibradas para la otra persona |     24 | se portan a s0028 o se retiran: rejilla 8 mm (PR 65), costillas, fascia renal… |

Al corregir las poses, `aortaPulse` destapó el único fallo real hallado: en la raíz aórtica, dentro del corazón, la GPU daba sangre
donde la CPU da pared (decisión 398, PR 68). La lista por prueba va en la descripción de la PR de este documento.

## Qué se borra

- Producto: `src/anatomy/people/default` (lo comparten `default` y `legacy`), sus atlas y superficies (19,9 MB comprimidos en el
  repositorio), la rama de `selectPerson` y lo que solo existe para ellas en el renderizador (A0 y rejilla propias, decisión 339).
- Pruebas (decisión 399, aprobada por el responsable el 15-11-2026): la escena procedural de apoyo
  (`validation/support/legacyPerson`, que usan 173 archivos unitarios y que también monta s0028 en `loadS0028`) sigue como apoyo
  de pruebas del motor, fuera del producto. Solo se portan a s0028 las pruebas de lo que el alumno ve; las 26 e2e que arrancan con
  `?abdomen=legacy` se portan o se retiran con su persona.

## Orden propuesto

1. Persona por defecto s0028 (PR 66), con la otra en `?abdomen=atlas`. No se borra nada.
2. Las e2e genéricas que fallan con s0028 se arreglan o se fijan a la otra persona con su motivo.
3. El gate de equivalencia de `legacy` cede el sitio al de s0028.
4. Se retira la otra persona del producto: código, atlas, presupuestos y paquete, con las cifras de memoria y descarga en la PR.
5. Se decide qué pruebas unitarias se portan y cuáles se retiran con ella.
