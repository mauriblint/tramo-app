# Reenviar reservas por email

Los usuarios reenvían confirmaciones (vuelos, trenes, hoteles) a `bookings@trytramo.com` y las agregamos a su viaje.

```
usuario reenvía → bookings@trytramo.com
  → Cloudflare Email Routing (regla de esa dirección) → Email Worker (ops/email-worker.js)
  → POST /api/inbound/email (mail crudo + secreto compartido)
  → backend/src/inbound.ts: remitente → cuenta, parser de reservas, ¿a qué viaje va?
```

- **Quién es:** el `From` del reenvío (o el remitente del sobre) tiene que ser el email de una cuenta. Si no, el mail se descarta en silencio (202, sin rebote). Los mails que Cloudflare marca con `dmarc=fail` también se descartan.
- **A qué viaje va:** si el usuario tiene un solo viaje en curso o futuro y todas las fechas de las reservas caen dentro de ese viaje (con 2 días de margen), se agregan directo. Si no, el mail queda en `/bookings` para que el usuario elija el viaje. Al abrir la app con mails pendientes, se lo lleva ahí.
- **Duplicados:** reenviar el mismo mail dos veces no duplica las reservas (misma clave de tipo, fecha, hora, número y localizador).
- **Todavía no:** adjuntos PDF (solo se lee el cuerpo) y mails "reenviados como adjunto" (`message/rfc822` dentro del mail).

## Configuración

### 1. Backend (servidor)

En el `.env` de producción:

```
INBOUND_ADDRESS=bookings@trytramo.com
INBOUND_SECRET=<openssl rand -hex 32>
```

Si `INBOUND_SECRET` no está, el endpoint responde 503. `INBOUND_ADDRESS` solo hace que la app muestre la dirección.

Nginx: sumar el bloque `location = /api/inbound/email` de `ops/nginx-tramo.conf` (sin él, nginx corta los mails de más de 1 MB). Después, `nginx -t && systemctl reload nginx` y reiniciar el backend con pm2.

### 2. Worker (Cloudflare)

1. **Workers & Pages → Create → Worker**, por ejemplo `tramo-inbound`. Pegar `ops/email-worker.js` y hacer **Deploy**.
2. En **Settings → Variables and Secrets** del Worker:
   - `BACKEND_URL`: la URL pública de la app, sin barra final (por ejemplo `https://trytramo.com`).
   - `INBOUND_SECRET` (tipo *Secret*): el mismo valor que en el `.env`.
   - `FORWARD_TO` (opcional): una dirección de destino ya verificada en Email Routing (por ejemplo tu Gmail) que recibe una copia de cada mail. Sirve mientras probamos.

### 3. Regla de Email Routing

**Email → Email Routing → Routing rules → Create address**: dirección `bookings`, acción **Send to a Worker**, Worker `tramo-inbound`. La regla de esa dirección tiene prioridad sobre el catch-all, así que todo lo demás sigue yendo a Gmail.

### 4. Probar

- Reenviar una confirmación a `bookings@trytramo.com` desde el email de tu cuenta.
- En el servidor: `pm2 logs` y buscar líneas `[inbound]` y `[llm:bookings]`.
- En Cloudflare: los logs del Worker (**Observability** o *real-time logs*) muestran si llegó y qué respondió el backend.

En local no hace falta Cloudflare. Guardá un mail como `.eml` (Gmail → "Mostrar original" → "Descargar original") y mandalo con `curl`:

```bash
curl -X POST localhost:3100/api/inbound/email -H 'x-inbound-secret: dev' --data-binary @confirmacion.eml
```

(con `INBOUND_SECRET=dev` en `backend/.env`).
