# MELI Intel — Inteligencia de mercado para Mercado Libre Chile

Backend que analiza nichos de productos en mercadolibre.cl para decidir qué importar y vender vía Mercado Libre Full. Por nicho responde: ¿cuánta demanda hay?, ¿quién compite y qué tan fuerte?, ¿hay espacio de margen y posicionamiento?

**Estado: Fase 1 (MVP)** — scan nivel 1 vía Apify, normalización, persistencia con serie temporal y reporte de precio/competencia. `demanda` y `scoreOportunidad` quedan en `null` hasta la Fase 2 (nivel 2: vendidos, sellers).

## Stack

Node.js 20+ / Express · MongoDB (Mongoose) · BullMQ + Redis · Apify API

## Setup

```bash
npm install
cp .env.example .env   # completar MONGO_URI, REDIS_URL y APIFY_TOKEN
npm start              # API + workers en un solo proceso
npm test               # unit + integración (usa MongoDB en memoria, no necesita servicios)
```

> En esta máquina no hay MongoDB ni Redis instalados: apuntar `MONGO_URI` a Atlas y `REDIS_URL` a un Redis administrado (Upstash, Render Key Value), o instalarlos con Homebrew.

## Pipeline

```
POST /api/nichos ──► cola scan-nicho ──► actor Apify nivel 1 (keyword)
                          │                    │
                          │              normalizador (precios, flags de envío, SKU, dedup)
                          │                    │
                          │              upsert `productos` + insert `snapshots` (1 doc/producto/scan)
                          ▼
                     cola calcular-metricas ──► scorecard → `reportes`
```

- Jobs con `attempts: 3` y backoff exponencial (5s/10s/20s); si Apify falla 3 veces el job queda en `failed` con el mensaje legible de `ApifyError` como `failedReason`.
- Workers con concurrencia 1 y rate limit (2 scans/min) para cuidar créditos de Apify.
- El token va por header `Authorization: Bearer` (equivalente al `?token=` de la doc de Apify, pero no queda en URLs ni logs).
- El modo sync de Apify (`run-sync-get-dataset-items`) se corta a los 300s; para runs largos existe `ejecutarActorAsync()` en `src/services/apify.js` (start + polling), pensado para los batches del nivel 2.

## Fuente de datos (nivel 1)

Actor `karamelo~mercadolibre-scraper-espanol-castellano`. Input validado contra su schema público (2026-07-16):

```json
{ "keyword": "foco solares", "country": "https://listado.mercadolibre.cl/", "maxPages": 2, "promoted": false }
```

Normalizaciones sobre su output (campos en español, casi todo string):

| Campo crudo | Normalización |
|---|---|
| `nuevoPrecio` / `precioAnterior` | `"15990"`, `"9747,93"` (coma decimal), `"12.990"` (punto de miles) → `Number` |
| `Envio` | flags `{full_icon}` → `esFull`, `{same_day_*}`/`{next_day_*}` → `envioRapido`, `{free_shipping}` → `envioGratis` |
| `zProductoLink` | `/p/MLC…` → `tipoListing: "catalogo"`, resto → `"listing"` |
| `SKU` vacío | se extrae `MLC…`/`MLCU…` desde la URL (`MLC-123…` → `MLC123…`) |
| `resultadosTotales` | `"+9.999 resultados"` → `{ total: 9999, esMinimo: true }` |
| items repetidos | dedup por SKU conservando la mejor posición (promocionados duplican) |
| `numeroEvaluaciones`, `sellerID` | vienen vacíos en nivel 1; los completa el nivel 2 (Fase 2) |

## API

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/nichos` | crea nicho `{keyword, frecuenciaScan?, domainCode?}` y encola el primer scan |
| GET | `/api/nichos` | lista nichos con resumen del último reporte |
| GET | `/api/nichos/:id/reporte` | scorecard completo + top 10 productos + top sellers |
| POST | `/api/nichos/:id/scan` | fuerza un scan manual |
| GET | `/api/productos/:sku/historia` | serie de snapshots (precio, posición; `?limit=`) |
| GET | `/api/salud` | estado de Mongo y Redis |

```bash
curl -X POST localhost:3000/api/nichos -H 'Content-Type: application/json' -d '{"keyword": "foco solares"}'
curl localhost:3000/api/nichos
curl localhost:3000/api/nichos/<id>/reporte
curl localhost:3000/api/productos/MLC45499727/historia
```

### Scorecard (Fase 1)

`metricas.precio`: mediana, p25/p75, min/max, banda de precio dominante (bins Freedman–Diaconis, robusto a outliers), % con descuento y descuento promedio.
`metricas.competencia`: sellers únicos en top 50, % tienda oficial, concentración del top 3, % Full, % envío rápido, top sellers.
`metricas.calidad`: rating promedio y % con rating.
`metricas.demanda` y `scoreOportunidad`: `null` hasta Fase 2 (pesos ya configurables en `src/config/scoring.js`).

## Verificación de los criterios de aceptación (Fase 1)

- **≥40 productos en <3 min con "foco solares"**: requiere `APIFY_TOKEN` real. `npm start`, luego el `curl` de POST de arriba; con `maxPages: 2` el actor trae ~100 items. Revisar con `curl localhost:3000/api/nichos/<id>/reporte`.
- **Precios con coma decimal / flags de envío**: cubierto por tests (`test/normalizador.test.js`) con output real del actor.
- **Re-scan no duplica productos, sí agrega snapshot**: cubierto por `test/persistencia.test.js` contra MongoDB real en memoria; en vivo, `POST /api/nichos/<id>/scan` de nuevo.
- **Retry 3x y failed legible**: configurado en `src/jobs/queues.js` (`opcionesJob`); inspeccionar con `redis-cli` o Bull Board si se quiere UI.

## Estructura

```
src/
  config/       env.js (validación), scoring.js (pesos Fase 2)
  db/           conexión Mongo
  models/       Nicho, Producto, Snapshot (serie temporal), Seller (Fase 2), Reporte
  services/     apify.js (sync + async + errores legibles), normalizador.js,
                persistencia.js (upsert por SKU), metricas.js (scorecard)
  jobs/         queues.js (BullMQ + retry), workers.js (scan-nicho, calcular-metricas)
  api/          app.js + rutas
test/           unit (normalizador, métricas) + integración (persistencia, API) con mongodb-memory-server
```

## Deploy en Render

`render.yaml` define el blueprint: web service `meli-intel` (API + workers en un proceso) y Key Value `meli-intel-redis` para BullMQ (`noeviction`, requerido). Al crear el blueprint, Render pide `MONGO_URI` (usar MongoDB Atlas — Render no ofrece Mongo) y `APIFY_TOKEN`. `PORT` lo inyecta Render automáticamente.

## Próximas fases

- **Fase 2**: actor de detalle `ecomscrape~mercadolibre-product-details-scraper` (correr primero con 3-5 URLs y ajustar mapeo al output real — no asumir schema), sellers, vendidos y delta entre snapshots (la métrica estrella), score de oportunidad.
- **Fase 3**: cron diario multi-nicho según `frecuenciaScan`, alertas (precio >15%, seller nuevo en top 10), export CSV.

## No hacer

- No scrapear directo a mercadolibre.cl desde este servicio (Apify es la fuente; el scraper cheerio propio existe aparte como plan B).
- No usar la API oficial de ML con credenciales de la cuenta seller.
- Sin frontend por ahora.
