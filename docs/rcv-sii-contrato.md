# Contrato del RCV del SII — capturado el 25-ago-2026

Sondeado en vivo desde el navegador con sesión propia. NO hay API oficial: el
RCV de sii.cl es una app Angular que llama endpoints JSON internos. Estos son.

## Endpoints

```
POST https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getResumen
POST https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getDetalleCompra
POST https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getDetalleVenta
```

## Cuerpo

```json
{
  "metaData": {
    "namespace": "cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getResumen",
    "conversationId": "<valor de la cookie TOKEN>",
    "transactionId": "<uuid v4 nuevo por llamada>",
    "page": null
  },
  "data": {
    "rutEmisor": "78469441", "dvEmisor": "0",
    "ptributario": "202608",
    "estadoContab": "REGISTRO",   // REGISTRO | PENDIENTE | NO_INCLUIR | RECLAMADO
    "operacion": "COMPRA",        // COMPRA | VENTA
    "busquedaInicial": true
  }
}
```

El detalle agrega `codTipoDoc` (ej "43") y dos campos de recaptcha:
`accionRecaptcha` = `RCV_DETC` (compra) o `RCV_DETV` (venta), y
`tokenRecaptcha` = `"t-o-k-e-n-web"` — literal, un placeholder. Con sesión
iniciada el recaptcha no se valida. Puede cambiar; si un día 403, es esto.

## Autenticación

Solo cookies del dominio, puestas por el login normal de sii.cl:
`TOKEN`, `CSESSIONID`, `RUT_NS`, `DV_NS`, `NETSCAPE_LIVEWIRE.*`.
No hay bearer ni API key. `conversationId` del cuerpo = cookie `TOKEN`.

`NETSCAPE_LIVEWIRE.exp` trae el vencimiento de la sesión (AAAAMMDDHHMMSS).

## TRAMPA: la cabecera Accept

Con `Accept: application/json` el servidor responde **HTTP 500** con
`org.jboss.resteasy.spi.NotAcceptableException: RESTEASY001530`. Hay que mandar
exactamente lo que manda la app:

```
Accept: application/json, text/plain, */*
```

Costó un rato encontrarlo: el error no dice nada de la cabecera.

## Respuesta del resumen

```json
{"data":[{"rsmnTipoDocInteger":43,"dcvNombreTipoDoc":"Liquidación-Factura Electrónica",
          "rsmnTotDoc":4,"rsmnMntNeto":510544,"rsmnMntIVA":96999,"rsmnMntTotal":607543}],
 "totDocRes":4,
 "dataCabecera":{"dcvFecModificacion":"03/08/2026 00:47:45"},
 "respEstado":{"codRespuesta":0}}
```

## Respuesta del detalle

Campos útiles por documento: `detNroDoc` (folio), `detFchDoc`, `detRutDoc`+`detDvDoc`,
`detRznSoc`, `detMntNeto`, `detMntIVA`, `detMntExe`, `detMntTotal`,
`detEventoReceptorLeyenda`, y los de liquidación factura:
`detLiqValComNeto`, `detLiqValComExe`, `detLiqValComIVA`, `detLiqRutEmisor`.

**Los tres `detLiqValCom*` vienen en 0 (ventas) o null (compras).** ML no está
poblando la comisión ahí, así que el [520] del F29 NO sale del RCV.

## OJO al construir el cliente

- **Un solo intento de login. Nunca reintento automático**: el SII bloquea la
  cuenta tras fallos repetidos, y una cuenta tributaria bloqueada en semana de
  declaración no se arregla con un deploy.
- Hay que consultar REGISTRO **y** PENDIENTE: en agosto 2 liquidaciones estaban
  en cada estado, y contar solo REGISTRO habría declarado 2 documentos donde son 4.
