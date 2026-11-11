# Red renal73: mejora integrada y coste GPU aprobado

Sobre main adaf672 (PR353), rama aislada codex/renal-network-73. El trabajo reorganiza seno/pirámides y conecta seis raíces interlobares derechas a su arteria/vena principal. Conserva sus tres nodos y calibres originales, el espesor de pared, la identidad Doppler, el contorno renal y la relación con hígado/grasa/fascia. No mueve la sonda ni modifica filtros, ganancia, PSF o resolución. Geometría estimada, no nueva segmentación clínica.

El seno current reduce sólo su semieje hiliar12→9mm; otras dimensiones y posiciones papilares/bases permanecen. Se retiran tres de15prolongaciones redundantes y la papila polar compuesta13 reduce radio4→3mm. La propuesta inicial de9prolongaciones fue sustituida por12 durante el piloto de geometría; protocolos/negativos originales conservados. La geometría izquierda comparte el seno/pirámides; la nueva red vascular es derecha. Legacy/s0028 conservan su anatomía.

## Imagen

COMPARISON.png muestra main a la izquierda y candidato a la derecha, corte completo y el mismo recorte ampliado. El núcleo brillante es menos compacto y deja mayor separación medular. Capturas reales; sin manipulación de contraste. Ocho entradas pareadas conservan pose, sample30s, seed20260921, historia128–134, armónica y reducción de moteado0. PAIRED-INPUTS.json sólo separa frameMs de ejecución y padding previo de alineación; no son cambios de adquisición.

Las ocho imágenes final/ son exactamente las de geometry-final/ sin la optimización (FINAL-PIXELS y verificador Python separado). Doce capturas angulares adicionales comparan renal/hepatorrenal normal a−4/0/+4grados con poses idénticas por pareja; no son navegación ni banco de coste. El seguimiento temporal original se ejecutó aparte.

## Coste y mecanismo

Cuatro bancos anteriores se rechazan íntegramente: geometría original, rejilla8, cota axial y cota3D. Las cotas se retiraron. El reparto completo de A0/B y luego sólo A0 alteraba algunos últimos bits de dirección reflejada y pocos grises: descartados antes de medir coste.

La solución utiliza clasificación directa precalculada RGBA32F en A0; mantiene bisecciones, reflejos y pleura en el bucle original. B nativa sigue intacta. Rejilla vascular current8mm con fallback16/32mm, techo4MiB. SwiftShader conserva su implementación por etapas; s0028 nativa mantiene A0 original/rejilla16. No cache de imágenes ni congelación de anatomía.

Banco final cost-final: Metal AppleM4,192×1024, ocho estados normal/grave×renal/hepatorrenal/portal/subcostal. Tres cuadros de calentamiento/vía/estado, siete pares alternados de cinco cuadros,560medidos. Consulta GPU envolvente de todas las pasadas; ambas escenas residentes,RAF detenido, mismas poses variables/muestra; sin capturas/readback medidos. Razón suma de medianas0,53092293797 (−46,9077%). Las ocho medianas y ocho p95nearest-rank (siete intervalos=el máximo) pasan≤base. Razones medianas0,451071–0,627929; p950,461981–0,643180. Todos los extremos se conservan. Primer banco de variante aprobado también preservado (−46,52%); final responde a cambio de selección de shader, no repetición selectiva.

No son FPS, coste de compositor, Worker, frío ni ahorro universal. Preparación/envío CPU separados en cada original, no sumar medianas. Objetivos A0 extra1.004.544B nominales; índice inicial1.335.296/1.343.488B por caso, no RSS/VRAM. El contenedor nativo aún reserva programas/objetivos de refinamiento aunque sólo dibuja rejilla+reducción. No se afirma memoria total aprobada.

24 estados reservados comparan los tres RGBA32F completos A0 contra programa original con la MISMA anatomía candidata:55.296uint32 por vía idénticos, sin tolerancia. Verificador Python reconstruye coste/conteos/pares/imágenes/arrays sin repetir GPU. No es oráculo anatómico independiente.

## Validación y alcance

Contratos de raíces, luces/paredes, separación arterial/venosa, seno y envoltura aprobados. Paridad regional CPU/GPU conserva exclusión explícita≤0,1mm de interfaces y reporta interfaces ajenas: no resuelve los defectos históricos47/48 ni los dos testigos72 de interfaz circundante. Las referencias históricas y negativos permanecen. Nuevo fixture acredita15cambios dentro de riñones sobre82.251puntos; shaders permiten sólo tablas renales y nueva variante A0, con programas y ABI protegidos.

Calibración exit0, ocho E2E Metal de geometría/transmisión/seguimiento pasan antes del cierre de alcance. Build de cierre default1.036.276B y s00281.070.026B, margen54B, sin subir techos. Estado del check completo y E2E final en CLOSURE.json; no inferir CI, commit o merge de esta descripción. Sin tareas programadas.

Incidentes, verificador previo fallido, presupuestos negativos y errores de arnés se conservan en originales e INCIDENTS-current.md. Índice nuevo sólo añade73:112entradas históricas idénticas, no declara hashes históricos disponibles en esta raíz parcial.

Cierre final: check completo exit0 (2.330pasan+16fallos esperados,331archivos), calibración exit0,6E2EMetal y5SwiftShader pasan sin reintentos. Las8capturas tras aislar s0028 son exactamente iguales a las del banco final. Fuente/fingerprint y parches conservados. Cambios locales en rama aislada; sin commit/PR/CI nueva/merge.
