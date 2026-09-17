# Descubrimiento de productos y aprendizaje de nichos entre temporadas

Fecha: 2026-09-11. Estado: primera implementación en modo sombra.
Se implementaron y probaron los entrenamientos con datos sintéticos y MongoDB
temporal. Todavía no se consultó producción ni se entrenó con datos reales.

## Implementación disponible

Tres modelos supervisados con regresión ridge, estandarización del entrenamiento
y resolución SVD mediante `ml-matrix@6.15.0`. Los coeficientes se ajustan con
observaciones; no son una tabla de puntuaciones manuales ni texto del LLM.

- **Demanda:** aprende el cambio respecto del mismo mes del año anterior usando
  crecimiento reciente y estacionalidad. Pronostica a tres, cuatro y cinco meses
  del último mes disponible. Ajusta regularización y peso de lo reciente en
  cortes anteriores a una prueba final de cuatro fechas. Compara contra repetir
  el año anterior y mantener el último valor. La métrica balancea keywords para
  que un mercado grande no oculte todos los errores de los pequeños.
- **Comercial:** aprende unidades pagadas por cien visitas a partir de categoría,
  precio y logística. No equivale a probabilidad de compra ni a rentabilidad.
  Reserva productos completos y fechas futuras para probar transferencia. No
  extrapola a categorías, precios o logística fuera del dominio observado.
- **Comercial con contexto del nicho:** une las mismas ventas y visitas propias
  con capturas de **Zyte** y series de **DataForSEO**. Añade demanda, crecimiento,
  estacionalidad del mes, precio de venta relativo al mercado, Full observado,
  proporción de catálogo y reseñas públicas con indicadores de cobertura.
  Compara su error con el promedio y con el modelo sin contexto entrenado sobre
  exactamente las mismas filas y evaluado sobre los mismos productos y fechas.
  Esta prueba reserva productos, no nichos completos: no demuestra transferencia
  a una categoría o nicho completamente nuevo.

El entrenamiento corre en un worker thread con memoria y tiempo limitados para
no bloquear Express. MongoDB conserva datos, versiones, coeficientes, evaluación
y pronósticos inmutables. Las mismas funciones de variables y predicción se usan
al entrenar y al consultar. Un dataset sin cambios no vuelve a entrenarse.

La captura mensual usa las consultas que ya se hacen a DataForSEO y conserva
ceros, huecos y revisiones por separado. El scan de propios registra ventanas
comerciales solo después de una sincronización completa de órdenes, con stock
observado y logística estable. Desde el 17-sep-2026 un cambio de precio ya no
anula la semana: medido en producción, las campañas de ML movían el precio
efectivo cada 4-5 días y en cinco días no se guardó ninguna observación. El
precio de la semana es el promedio ponderado por tiempo, se guardan mínimo,
máximo y número de cambios, y el entrenamiento excluye las semanas cuyo precio
varió más de 15%. Cada descarte declara su motivo en el log del scan y en la
pestaña Aprendizaje. Se conservan `date_from` y `date_to` de la
API de visitas y las órdenes se cuentan en esos límites, que pueden diferir de
la hora del scan. Sin fechas verificables no se crea una observación. Al entrenar se seleccionan ventanas que
no se solapan por producto. La tasa antigua de seis días de ventas sobre siete
de visitas se corrigió para devolver dato insuficiente.

El radar registra pronósticos de sus candidatas en paralelo. **Los perfiles y
predicciones ML quedan fuera del prompt, los filtros y el orden del radar.**
Los perfiles propios observados y el modelo comercial se pueden consultar por
API; su incorporación a las recomendaciones requiere la validación real posterior.
Los modelos con más de noventa días no generan nuevas estimaciones.

### Libro diario de productos propios (17-sep-2026)

Pedido del importador: que el aprendizaje empiece a leer TODAS las ventas ya,
porque el catálogo está creciendo y el tiempo de captura no se recupera. Las
series embebidas en `ProductoPropio` son rodantes —`mediciones` guarda seis
días, `historialPrecios` veinte cambios, que con una campaña cada cuatro días
son dos meses y medio— así que lo que no se congela se pierde.

`DiaProductoMl` guarda un renglón por producto y día UTC (el día con que ML
reporta visitas): visitas, unidades y órdenes pagadas, precio efectivo promedio
del día con mínimo y máximo, logística, y la fracción de mediciones con stock.
Guarda todos los días —cero visitas, quiebres, promociones—; qué entra a un
entrenamiento se decide al entrenar. Medido contra la cuenta: ML entrega
visitas por día hasta 150 días atrás y omite los días en cero (la suma de los
presentes es el total), así que la primera pasada recupera la historia completa
de cada producto. Después corre una vez al día por producto dentro del scan de
propios, agrega el día cerrado y recalcula los últimos catorce por las órdenes
que se pagan o anulan tarde. Un producto nuevo entra solo, con su historia, el
día en que el importador automático lo reconoce.

Del libro se derivan semanas con el mismo contrato del registro en vivo (siete
días con stock medido y completo, una logística, precio conocido) y se guardan
en `ObservacionProductoMl` con `fuente: 'libro-diario'`. Límites honestos: el
stock se mide desde el 1-sep-2026, así que no hay semanas entrenables
anteriores; el precio anterior al primer cambio conservado se marca
`precioInferido` y no entra a semanas; a los días recuperados no se les atribuye
nicho. Primera pasada en seco: 394 días de 8 productos desde el 20-jul, 32
semanas derivables, 3 entrenables sin solapar.

### Tres fuentes nuevas para el aprendizaje (17-sep-2026, tarde)

Pedido del importador: "llevar el scraper a otro nivel", y que lo que funcione
"se lo entregaremos también al learning machine".

- **Reseñas de todo el listado.** La demanda del nicho se cuenta con la API
  oficial de ML (`numReviewsApi`) sobre el listado orgánico entero —4 páginas,
  ~200 publicaciones— cuando compara al menos 1,5× los productos de la ficha
  pagada. El reporte guarda `fuenteResenas` y las dos señales. ML frena después
  de ~115 consultas seguidas (medido: 116 de 202 en el primer scan de 4
  páginas), así que el contador va de a 3, con freno compartido y reintento.
- **Stock del competidor.** La ficha que ya se paga trae `"quantity"` en su
  evento de telemetría: el stock del vendedor, exacto hasta 50 y topado en 51.
  `Snapshot.stock` / `stockTopado` lo guardan, `CapturaNichoMl` lo congela con
  su fecha, y `ventaEntreLecturas` convierte dos lecturas en unidades vendidas
  —solo si ninguna está topada y el stock no subió—. Es la única etiqueta de
  ventas AJENAS que no pasa por reseñas ni por baldes; hoy solo se captura, y
  entra a un modelo cuando haya serie suficiente y se valide contra las ventas
  propias, donde se conoce la verdad.
- **Ranking oficial de más vendidos.** `/highlights/MLC/category/{id}`, gratis,
  guardado cada día a las 07:40 por categoría dominante de cada nicho
  (`RankingMasVendidos`). Lo que entra al top 20 o sube cinco puestos llega al
  radar con nombre, como evidencia de demanda dicha por ML; la carta abierta de
  cada oportunidad muestra el top 10 con lo que se movió. La posición diaria es
  además una serie de demanda relativa por producto, disponible para entrenar.

### Seguimiento de stock de vendedores chicos (17-sep-2026, noche)

El stock de ML también viene en baldes ("+5", "+10", "+25", "+50"; exacto solo
con pocas unidades), así que una lectura es un rango y dos lecturas dan un PISO
de unidades vendidas (`ventaEntreLecturas`). Con el nicho leído cada ~6,5 días,
un vendedor puede vaciarse y reponer sin que se note. `seguimientoStock.js`
mantiene una lista corta —hasta 6 por nicho en cotización o con ventana abierta:
no oficiales, con stock visible, uno por vendedor— y lee solo esas fichas, cada
2 horas lo que toque: "+50" semanal, baldes medios diario, "+5" o exacto cada 12
h. **Tope duro de US$30 al mes** (`SEGUIMIENTO_USD_MES`), con freno diario de
tope÷30; la lectura que falla se paga y se cuenta igual. Cuatro semanas en "+50"
o tres fallos sacan a la publicación de la lista.

Las publicaciones propias entran a la misma lista: se leen desde afuera como un
competidor y, como su venta real está en `VentaMl`, dan la **calibración** —qué
porcentaje de las unidades reales ve el método—. Sin ese número el piso no se
debería usar para decidir un contenedor. `LecturaStock` guarda cada lectura con
su fecha: es la serie que el aprendizaje puede usar como etiqueta de ventas
ajenas cuando la calibración diga cuánto vale.

### Auditoría de huecos de captura (17-sep-2026)

Qué se estaba dejando pasar que después no se recupera, y qué se hizo:

- **Publicidad por producto y día — no se guardaba.** Se leía en vivo para la
  pantalla; ML la retiene ~90 días. Es el 25% del bruto y lo que explica buena
  parte de las visitas: sin ella ningún modelo separa lo que vendió el producto
  de lo que compró el anuncio. `AdsDiaMl` guarda impresiones, clics, gasto y
  unidades atribuidas/orgánicas por producto y día de Chile, más el total de la
  cuenta. Una vez al día relee la última semana (la atribución llega tarde) y
  recupera hacia atrás hasta 40 días por pasada.
- **Órdenes reembolsadas contadas como ventas.** La sincronización solo pedía
  las pagadas, así que una orden que se reembolsaba quedaba guardada como venta
  para siempre: ML 285 pagadas + 8 anuladas, la base 290. Ahora se leen también
  las anuladas, se marcan, salen de los agregados de ventas, y ese día el libro
  se rehace completo. La contabilidad no se tocó: ahí mandan boletas y notas de
  crédito.
- **Cierre del día.** El libro ahora congela unidades en bodega, reseñas, nota
  y la campaña de ML vigente; antes vivían solo en los seis días de `mediciones`.
- **La salud del nicho se lee contra el mercado** (`saludRelativaAlMercado`): la
  variación de cada keyword dividida por la mediana de todas las medidas.

Siguen abiertos, y no se arreglan con código: el **costo unitario** de los
propios (sin él hay contribución, no margen), los **ciclos de importación**
(fecha de compra, llegada, cantidad y costo puesto por lote — hoy no existe
dónde anotarlos y es lo que une una recomendación con su resultado), y la
**posición orgánica** de cada propio en su nicho, que solo se ve cuando el scan
semanal del nicho lo encuentra.

### Primer entrenamiento real (14-sep-2026) y por qué pierde

El modelo de demanda entrenó con 113 series y 7.119 ejemplos y quedó **19,9%
peor que repetir el mismo mes del año anterior** (MAE log 0,328 contra 0,274;
le gana a mantener el último valor, 0,458). Los coeficientes se recuperaron de
sus propios pronósticos en producción, con residuo de redondeo:

| variable | coeficiente |
| --- | --- |
| estacionObjetivo | **−0,427** |
| crecimiento12m | +0,191 |
| crecimiento6m | +0,039 |
| horizonte | −0,010 |
| impulso3m | −0,004 |
| intercepto | −0,045 |

Manda `estacionObjetivo`: el modelo borra ~43% de la distancia entre el mes de
referencia y el promedio anual. La primera hipótesis fue que esa variable era
la culpable. **Probado el 17-sep con las 188 series reales y el mismo protocolo
de evaluación: era falsa.** Quitarla empeora (de −13,6% a −24,7% contra la
referencia estacional).

Lo que pasa es otra cosa: **todas las variantes subestiman** (sesgo −0,11 a
−0,17 en log, creciente con el corte), porque las 188 keywords se mueven juntas.
Mediana del cambio interanual de los últimos tres meses, por mes de origen:

| 2024-01 a 08 | 2024-12 | 2025-06 a 11 | 2026-03 | 2026-04 | 2026-08 |
| --- | --- | --- | --- | --- | --- |
| +22% | 0% | −13% a −16% | −6% | 0% | +7% |

Es un factor común —del mercado o de cómo Google recalibra sus volúmenes— y no
una señal de cada producto. El entrenamiento cayó entero en la fase de bajada y
la prueba en la de recuperación: cualquier variable de crecimiento extrapola la
bajada justo cuando se da vuelta. Probado y descartado, todo contra la
referencia estacional (MAE 0,2443): sin estacionObjetivo 0,3047 · solo
crecimiento 0,3000 · referencia promediando dos años 0,2659 (y sola, sin modelo,
0,2595) · referencia suavizada a tres meses 0,2782 · modelo encogido a la cuarta
parte 0,2506 · deriva del mercado como variable 0,2734 · referencia × deriva del
mercado 0,2828. **Nada le gana a repetir el año anterior.**

Conclusiones: (1) el pronóstico vigente para decidir compras es la referencia
estacional; el ridge sigue en sombra y no se promueve. (2) Con cuatro años de
historia hay como mucho un ciclo de ese factor común: no es un problema de
variables sino de cantidad de regímenes observados, y se resuelve con tiempo, no
con ingeniería. (3) Consecuencia fuera de este módulo: la salud del nicho
("bajando / muriendo", 30-ago) compara los últimos doce meses contra los doce
anteriores, y durante 2025 el mercado entero marcaba −13%. Una caída así no
distingue al nicho: habría que leerla RELATIVA a la mediana del mercado.
Pendiente de decisión del importador.

### Unión de Zyte, DataForSEO y Mercado Libre

Zyte es el proveedor por defecto de listado y detalle. `SCRAPER_LISTADO=zyte`
y `SCRAPER_DETALLE=zyte` requieren `ZYTE_API_KEY`; no exigen un token de Apify.
El adaptador antiguo solo se utiliza si se configura explícitamente. La captura
para este aprendizaje acepta únicamente scans cuyo proveedor real fue Zyte.

`CapturaNichoMl` conserva el listado normalizado y las revisiones del detalle,
con fecha del scan, fecha de disponibilidad, nicho y keyword de demanda medida
en ese momento. No consulta el estado mutable de `Producto` para reconstruir
capturas pasadas. Los reintentos iguales no duplican una captura, y el detalle
no se retrofecha al comienzo del scan. El rescate de reseñas por API oficial
del pipeline existente no se atribuye a Zyte.

Cada semana comercial usa el `nichoId` que tenía guardado al observarse y la
última captura de ese nicho disponible ANTES de comenzar la semana. La serie de
búsquedas también debe haber sido recuperada antes de ese comienzo. Cambiar una
keyword o recuperar historia hoy no añade evidencia retrospectiva a esas filas.
Las capturas deben tener como máximo 14 días; la serie necesita 24 meses
consecutivos cerrados y llegar al menos a uno de los dos últimos meses cerrados.

Se comparan hasta 30 publicaciones únicas con precio (mínimo diez), excluyendo
el item propio cuando se identifica. Full y reseñas incluyen cobertura para
distinguir cero observado de dato ausente. Las reseñas públicas pueden ser de
catálogo o publicación: su nivel es una señal de contexto, nunca una tasa de
ventas. Los buckets de vendidos se conservan para auditoría y no se utilizan
como etiqueta ni como variable del entrenamiento combinado.

La etiqueta supervisada sigue siendo **unidades pagadas por 100 visitas propias**;
no se fabrican ventas de competidores ni rentabilidad. El modelo combinado exige
al menos doce productos y tres nichos, 72 ventanas y filas suficientes para su
número de variables y sus cortes de prueba. Estos mínimos no garantizan precisión.
Para inferir, también exige contexto dentro de los rangos observados al entrenar;
si falta alguna fuente, se abstiene. No hay sustitución silenciosa por un modelo
sin contexto cuando se solicita una estimación con nicho.

La etapa acordada es mantener observación mientras se mejoran datos, modelos y
evaluación. Una prueba de integración verifica que, aunque existan perfiles ML,
el generador recibe el mismo prompt y entrega las mismas sugerencias con ML
habilitado o deshabilitado, usando una respuesta simulada del LLM. También
verifica que un fallo del registro ML no impide entregar las sugerencias.
Esto todavía está en la copia local: no se ha desplegado ni confirmado la
captura en producción.

### Pantalla de seguimiento

La pestaña **Aprendizaje**, dentro de Inteligencia, consulta estado, perfiles y
pronósticos. Se refresca cada minuto mientras está visible y permite actualizar
la vista manualmente. Solo hace lecturas: no tiene botones para entrenar,
activar decisiones o alterar productos.

Muestra cobertura, fechas de captura, continuidad del historial, estado y
evaluación de los modelos, semanas comerciales observadas y predicciones con
sus resultados posteriores. Los contadores distinguen predicciones contrastadas
de aciertos; los ceros observados se conservan. Sin datos muestra el motivo, y
ante un error conserva la última consulta con un aviso de desactualización.
Los modelos con más de noventa días aparecen vencidos. Los perfiles muestran
hasta veinte productos con semanas cerradas en los últimos noventa días; la
cobertura comercial usa ventanas cerradas en los últimos 730 días, como el
entrenamiento. El historial de nichos muestra hasta cien búsquedas.

El usuario confirmó que el catálogo actual incluye stock antiguo cuyo precio
de compra no se conoce con precisión, y que vienen más productos en camino.
**El costo de compra no se usa ni se exige para este aprendizaje.** El precio
comercial es el precio de venta observado. No se calcula margen, ROI ni
rentabilidad del stock anterior. Los productos por llegar aportarán resultados
cuando existan ventanas válidas de venta, visitas y stock; una orden de compra
o un embarque no es una observación de ventas. No se asignan ventas antiguas a
un lote nuevo ni se completan costos con estimaciones.

La pantalla se verifica con datos sintéticos y una base temporal; no se insertan
ejemplos en producción ni se presentan esas métricas como resultados del negocio.

El bloque **Tres fuentes, un mismo nicho** muestra las capturas de Zyte, la
búsqueda de DataForSEO vinculada, cuántas semanas y productos se pudieron unir,
y los motivos de exclusión (sin nicho, sin fuente anterior, datos vencidos o
incompletos). Un tercer modelo muestra la evaluación del aprendizaje combinado.
Consultar el panel no ejecuta scrapers ni llamadas a proveedores.

### Operación

Con `MONGO_URI` configurada, sin necesidad de arrancar Redis para estos comandos:

```sh
npm run ml:estado
npm run ml:capturar-series
npm run ml:entrenar
```

`ml:capturar-series` requiere las credenciales DataForSEO ya utilizadas por el
proyecto: consulta en lote las keywords de los nichos activos, respetando sus
correcciones. Esa consulta consume el servicio del proveedor. El entrenamiento
y la auditoría leen datos almacenados y no llaman a un LLM ni al proveedor.

Al arrancar la aplicación se registra el entrenamiento semanal, lunes 10:30 en
Chile. `ML_CRON` cambia la agenda. `ML_ACTIVO=false` desactiva la captura ML, su
entrenamiento y su integración con el radar. Los datos ya guardados permanecen.

Rutas bajo la protección `x-api-key` existente:

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/aprendizaje` | Cobertura, estados y evaluación de los modelos |
| GET | `/api/aprendizaje/perfiles` | Evidencia observada de los productos propios |
| GET | `/api/aprendizaje/pronosticos?keyword=...` | Predicciones congeladas y resultados posteriores |
| GET | `/api/aprendizaje/afinidad?categoria=MLC...&precio=10000&full=true` | Estimación comercial en sombra, o abstención |
| GET | `/api/aprendizaje/afinidad?categoria=MLC...&precio=10000&full=true&nichoId=...` | Estimación combinada con Zyte + DataForSEO + ventas, y referencias de las capturas utilizadas |
| POST | `/api/aprendizaje/entrenar` | Encolar entrenamiento sin duplicarlo durante la misma hora |

### Criterios y límites de esta versión

La demanda exige al menos tres series y suficiente continuidad para formar los
cortes temporales. El comercial exige al menos doce productos, 72 ventanas sin
solapar y cobertura suficiente en ambos lados de la prueba. Son mínimos
operativos; cumplirlos no demuestra precisión. Si faltan datos se guarda
`datos-insuficientes`, sin coeficientes ni tasa de acierto inventada.

La evaluación de demanda es retrospectiva con históricos recuperados: el
proveedor puede revisar datos. Los pronósticos emitidos desde ahora se evaluarán
por separado al conocerse el mes correspondiente. Los rangos son empíricos y no
tienen una garantía nominal de cobertura. La evaluación comercial controla
producto y fecha, pero sigue siendo observacional, no causal.

Pendiente con el acceso real: auditar cobertura y calidad, recuperar series,
entrenar, revisar desempeño por categoría y horizonte, y acumular validación
prospectiva. Después se podrá habilitar el ranking aprendido. La rentabilidad por
lote, la asignación de ventas a cada importación y una selección automática de
cantidades siguen siendo fases futuras; no se sustituyen por búsquedas ni por
unidades por visita.

Las secciones siguientes describen la dirección del producto. Donde amplían lo
anterior, corresponden al trabajo posterior a esta primera implementación.

## Objetivo

Mejorar los productos que el sistema recomienda importar, aprendiendo cómo
cambian la demanda, la competencia y los resultados de cada producto entre años.
La unidad de aprendizaje es producto o segmento × temporada × año.

Pregunta principal: ¿qué conviene traer para el período en que estará disponible
para vender, considerando lo que pasó antes y lo que está cambiando ahora?

El punto de partida incluye los productos que el importador YA vende en Mercado
Libre y sus conversiones, según confirmó el usuario. La propuesta debe descubrir
productos nuevos desde esa experiencia y desde señales externas de mercado.
Los productos anteriores a la existencia del radar también aportan resultados
comerciales; no se les atribuirá una recomendación histórica que nunca existió.

La personalización por decisiones del usuario y la optimización semanal de
reposición quedan para una fase posterior. La primera entrega se centra en
anticipar el mercado de los nichos recomendados.

## Lo que ya existe y la brecha concreta

- `volumenBusqueda.js` solicita historia de búsquedas con año y mes. Calcula una
  comparación de los últimos doce registros mensuales contra los doce anteriores.
- `curvaDeMonthlySearches()` promedia los distintos años en doce valores por mes
  calendario. `interpretar()` devuelve esa curva y resúmenes, pero no conserva
  la serie completa con sus años.
- `CurvaEstacional` mantiene un documento actual por keyword. Los refrescos
  actualizan ese documento: no constituyen un historial de lo que el sistema
  conocía al recomendar cada importación.
- Hay históricos de productos, snapshots, competencia y reportes. `sugeridor.js`
  propone nichos y `analista.js` los evalúa; las reglas de puntuación están
  configuradas a mano.
- `ventana.js` calcula cuándo comprar a partir del pico estacional y el plazo de
  llegada. Esa infraestructura permite orientar la predicción al momento de venta.
- `ProductoPropio`, `VentaMl` y `CargoMl` aportan resultados de lo que se trae.
  Falta enlazar de forma explícita recomendación, producto concreto y ciclo de
  importación, incluyendo llegada, cantidades, stock disponible y costos.

La comparación interanual existente es útil. El paso nuevo es predecir el próximo
período y aprender del error observado, conservando las diferencias entre años.

## Descubrir qué producto nuevo traer

El sistema debe construir un perfil medido de lo que funciona en la tienda:
tipo de producto, formato, precio efectivo, temporada, logística, visitas,
conversiones, ventas, disponibilidad y contribución cuando se conocen los costos.
Guardar los denominadores y las ventanas de cada tasa: una conversión alta con
pocas visitas no tiene el mismo respaldo que una observada con mucho tráfico.
Antes de usar la conversión actual, corregir la comparación de ventanas en
`conversionPropios.js`, identificada en la revisión anterior.

La búsqueda de candidatos tendrá tres orígenes complementarios:

1. **Ampliaciones de productos probados:** formatos, tamaños o versiones con
   demanda propia que todavía no cubre el catálogo.
2. **Productos relacionados:** accesorios o complementos de usos donde la tienda
   ya vende. La relación de uso o categoría genera una hipótesis; no demuestra
   que los mismos compradores los compren juntos ni que conviertan igual.
3. **Oportunidades nuevas:** categorías y productos detectados por tendencias,
   búsquedas relacionadas y cambios de oferta, aunque no tengan un equivalente
   entre los productos propios. Reservar capacidad de investigación para estos
   candidatos, dentro del presupuesto de scans existente.

Para cada candidato, medir búsqueda real de su producto/segmento, evolución
interanual, competencia, precio, logística y la ventana de llegada. Ordenar con
evidencia de mercado y afinidad con capacidades demostradas de la tienda. La
conversión de un producto propio no se copia como conversión esperada de otro.
Mostrar qué respalda la idea, qué falta medir y la incertidumbre de transferir
experiencia a una categoría nueva.

La arquitectura distingue generación de candidatos, evaluación y selección final
con diversidad. Primero se pueden usar atributos y comparaciones explícitas; el
orden aprendido se incorpora al disponer de resultados suficientes y demostrar
que supera esas referencias. No usar el score o el veredicto del propio LLM como
etiqueta de éxito: eso premiaría repetir su opinión anterior.

Conservar origen, evidencia y evolución de cada candidato. Evaluar su pronóstico
de mercado aunque no se importe y su resultado comercial solo cuando exista.
Al traerlo, sus ventas y conversiones amplían el perfil de productos probados y
ayudan a encontrar los siguientes candidatos, preservando la exploración de
categorías distintas para no encerrar el radar en los primeros éxitos.

### Integraciones existentes que se pueden aprovechar

- `sugeridor.js` ya incorpora productos propios que venden mediante
  `pasillosProbados()` y pide al LLM productos vecinos y categorías nuevas.
- `aprendizajes.js` consulta categorías hermanas de las que tienen ventas propias.
- `surtido.js` propone formatos ausentes en el catálogo a partir de competidores.

El trabajo es conectar estas piezas a evidencia comercial normalizada, seguimiento
por temporada y evaluación de resultados. Parte de la memoria `nicho-vende` se
actualiza hoy al consultar Mis productos; debe actualizarse desde un trabajo
programado para que el radar aprenda aunque nadie abra esa pantalla.

También hay que conciliar reglas contradictorias del sugeridor: conserva el veto
a productos fuera de Full mientras el analista ya contempla bodega propia, y
mezcla la instrucción de explorar vecinos probados con topes generales de vecinos.
Estos conflictos pueden eliminar candidatos útiles antes de medirlos.

## Ciclo de aprendizaje

1. Registrar qué producto o segmento se recomienda, para qué temporada y con qué
   condiciones esperadas de demanda, precio, competencia y disponibilidad.
2. Seguir el mercado del nicho después de la recomendación, se haya comprado o no,
   con una frecuencia y un presupuesto definidos.
3. Para los importados, relacionar la recomendación con el producto vendido y el
   ciclo de importación. Medir ventas, rotación, contribución cuando se conocen
   los costos y remanente al cierre del período.
4. Evaluar por separado si acertó el pronóstico del mercado y si funcionó la
   importación propia. Llegar tarde, quedarse sin stock o cambiar la publicidad
   no demuestra por sí solo que el mercado estuviera mal pronosticado.
5. Actualizar el modelo y la recomendación para la siguiente temporada usando la
   nueva evidencia. Una buena temporada anterior aporta información; no fija un
   veredicto permanente sobre el producto.

## Datos que hay que conservar

### Serie mensual del nicho

Guardar año-mes, producto/segmento, keyword exacta medida, país, fuente, valor,
fecha de consulta y cobertura. Mantener versiones de mediciones revisadas para
poder reconstruir qué datos estaban disponibles en cada fecha de recomendación.

Conservar la curva de doce meses para la interfaz, junto con la serie completa.
Validar meses faltantes y duplicados antes de comparar temporadas. Si cambia la
keyword, vincularla explícitamente; un cambio de frase no es crecimiento de demanda.

El proveedor actual documenta hasta cuatro años de historia de búsquedas. Ese
histórico permite iniciar el análisis del mercado sin esperar varios años de
ventas propias. Su disponibilidad por keyword debe verificarse. Búsquedas de
Google y ventas de Mercado Libre son objetivos distintos y se evalúan por separado.

Para precios, competencia y señales de ML, partir de los snapshots existentes y
preservar su fuente y cobertura. Los badges acumulados de ventas y las reseñas
son señales indirectas, no ventas mensuales exactas del mercado.

### Pronóstico del nicho

Un registro inmutable por recomendación y versión: fecha de emisión, producto,
segmento, temporada objetivo, llegada esperada, horizonte de venta, datos usados,
modelo, rangos previstos y condiciones. Cada revisión crea una nueva versión.

Ejemplo de horizonte: llegada esperada hasta cierre de temporada; para productos
de venta continua, un período definido desde la llegada. La evaluación debe usar
ese mismo horizonte, no sustituirlo después por la semana que mejor salió.

### Resultado de importación

Relacionar recomendación, producto propio y lote o ciclo. Guardar cantidad,
fechas de compra, llegada y disponibilidad efectiva, costo puesto, precios reales,
ventas, devoluciones, días sin stock y remanente. Si hay varios lotes del mismo
producto, declarar el criterio de asignación; no atribuir arbitrariamente ventas
históricas a la última compra.

La primera versión puede funcionar con seguimiento de mercado. Sin resultado
comercial propio verificable, no presentará acierto de rentabilidad ni un pedido
óptimo como hechos aprendidos.

## Primer modelo propuesto

Primer objetivo medible: evolución de las búsquedas del nicho durante la futura
ventana de venta. Después, combinar esa previsión con competencia, precio y
resultados propios para mejorar el orden de las recomendaciones de importación.

Comparar una referencia estacional —mismo período del año anterior— y las reglas
actuales contra un modelo sencillo de tendencia y estacionalidad, con variables
recientes disponibles en la fecha de compra. Probar cuánto histórico conviene
usar y cuánto peso dar a lo reciente mediante evaluación temporal, sin fijarlo
por intuición. Verificar modelos de tendencia amortiguada o regresión estacional
antes de añadir complejidad.

El aprendizaje consiste en ajustar parámetros con los errores de predicción:
cuánto aporta la temporada histórica, cuánto la evolución reciente y en qué
familias esas relaciones son estables. Para productos nuevos se puede evaluar
un modelo que comparta información entre segmentos comparables, manteniendo
incertidumbre mayor y validando que generalice a productos no vistos.

Con resultados propios suficientes, añadir previsiones de rotación y contribución
por ciclo. No entrenar éxito comercial usando el veredicto anterior de la IA como
verdad, ni tratar un nicho no importado como una compra fallida.

El modelo numérico genera pronósticos y evidencia. La IA utiliza esos resultados
para proponer productos y explicar qué cambió respecto de la temporada anterior.

## Adaptación entre años y validación

- Comparar períodos equivalentes: próxima temporada frente a las anteriores,
  incluyendo su tamaño, intensidad y posible desplazamiento del pico.
- Actualizar al llegar datos nuevos; medir cambios sostenidos frente al error
  habitual antes de interpretar una variación pequeña como una tendencia nueva.
- Ensayar ventanas de entrenamiento móviles y pesos de recencia; conservar
  patrones estacionales cuando ayudan y reducir su influencia cuando dejan de
  predecir bien. El criterio lo decide el rendimiento fuera del entrenamiento.
- Recrear recomendaciones en fechas históricas usando solo información entonces
  disponible, con el plazo de importación incorporado al horizonte.
- Al usar históricos recuperados hoy, distinguir una simulación retrospectiva de
  una prueba verdaderamente contemporánea: las fuentes pueden revisar datos.
- Evaluar errores de pronóstico y cobertura de rangos. Medir por separado cambios
  del mercado y resultados de los productos importados; no inventar una tasa de
  acierto comercial para nichos sin resultado propio.
- Comparar el candidato en paralelo contra el sistema actual antes de usarlo para
  modificar recomendaciones. Registrar versiones y conservar la referencia.

La experiencia de un año no garantiza el siguiente. Las recomendaciones deben
mostrar qué cambió, qué se espera para la llegada y cuánta incertidumbre hay.

## Integración y primera entrega

Se mantienen Node, MongoDB y BullMQ. Existen colecciones para series mensuales
versionadas, observaciones propias, modelos y pronósticos. Los ciclos de
importación quedan pendientes. El entrenamiento periódico se ejecuta en un
worker thread de Node y los resultados se guardan para su consulta.

Primera entrega concreta:

1. Auditar ventas y conversiones de productos propios, corregir sus ventanas y
   construir perfiles de productos probados con cobertura explícita.
2. Auditar cobertura histórica por nicho y conservar la serie mensual completa.
3. Conectar esos perfiles al descubrimiento de formatos, relacionados y productos
   nuevos; registrar candidatos y medirlos con el radar existente.
4. Generar una referencia por temporada futura y congelar cada pronóstico.
5. Evaluar los pronósticos y comparar un modelo que ajuste tendencia y
   estacionalidad conforme lleguen datos nuevos.
6. Incorporar la evidencia al radar y a las tarjetas de oportunidades, y enlazar
   los productos que se importen para aprender también del resultado comercial.

Ejemplo ilustrativo de salida: «Este producto funcionó la temporada pasada. Para
la próxima llegada la demanda prevista es menor y hay más competencia; la
recomendación baja de prioridad». Los valores y conclusiones concretos deberán
salir de datos medidos, no de una frase predefinida.

## Fuentes técnicas

- [scikit-learn: regresión ridge](https://scikit-learn.org/stable/modules/linear_model.html#ridge-regression-and-classification):
  mínimos cuadrados con regularización L2, referencia del modelo utilizado.
- [ml-matrix](https://github.com/mljs/matrix): biblioteca de álgebra lineal y
  resolución numérica utilizada por el entrenamiento en Node.
- [Mercado Libre: visitas](https://developers.mercadolibre.cl/es_cl/recurso-de-visitas):
  fechas de inicio y fin de las ventanas de visitas por artículo.
- [Google: sistemas de recomendación](https://developers.google.com/machine-learning/recommendation/overview/types):
  generación de candidatos, puntuación y selección final con diversidad y vigencia.
- [DataForSEO: Google Ads Search Volume](https://docs.dataforseo.com/v3/keywords_data-google_ads-search_volume-live/):
  historia mensual con año y mes; disponibilidad documentada de hasta cuatro años.
- [Forecasting: Principles and Practice — evaluación temporal](https://otexts.com/fpp3/tscv.html):
  comparar pronósticos avanzando la fecha de origen y evaluando horizontes futuros.
- [Forecasting: Principles and Practice — intervalos](https://otexts.com/fpp3/prediction-intervals.html):
  expresar la incertidumbre junto al pronóstico.
