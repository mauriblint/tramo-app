# Roadmap

Estado y próximos pasos de tramo. Las fases del rediseño del viaje se trabajan en la rama `trip-redesign`.

## Rediseño del viaje

- [x] **Fase 1 · Layout viaje → día → actividad.** Columna angosta en el celular; en desktop, sidebar verde + panel blanco. Pestañas Itinerario / Transporte / Hoteles / Ideas. Vista de día y de actividad.
- [ ] **Fase 2 · La generación escribe el día.** Tabla `trip_days` (título, resumen, barrios). Por actividad: duración, tip, cómo llegar desde la anterior. Botón para completar títulos de viajes ya generados.
  - El `title` es solo el nombre del lugar como figura en un mapa; los detalles ("observatorio sur", qué pedir) van a la nota.
  - Campo `placeQuery` (nombre buscable, en inglés o idioma local) para geocodificar sin depender de la redacción.
- [ ] **Fase 3 · Reservas.** Tabla `bookings` (vuelo, tren, bus, hotel). Pestañas Transporte y Hoteles con formulario. Las reservas aparecen como chips en el itinerario y bloques fijos en el día.
- [ ] **Fase 4 · Reservas inteligentes.** "Pegá tu confirmación" (la IA extrae los datos), avisos ruta ↔ hoteles, generación alrededor de las reservas.
- [ ] **Fase 5 · Ideas.** Rediseño de la pestaña.

## Geocodificación

Hoy: Nominatim (OpenStreetMap), gratis, 1 req/s, con caché en `geocache`. Busca `"{nombre}, {ciudad}"`, después el nombre sin detalles, y si nada funciona cae al centro de la ciudad (`approx`, que el mapa del día no muestra).

Si no alcanza: marcar en la UI los lugares sin ubicación exacta y permitir corregirlos pegando un link de Google Maps; después evaluar Google Places (más preciso, pago) o Mapbox / Photon.

## Idea a futuro: catálogo de lugares validados

**Qué es.** Una base propia de lugares por ciudad (atracciones, barrios, restaurantes, excursiones) con nombre canónico, coordenadas verificadas y datos útiles. La IA deja de inventar lugares: elige y ordena del catálogo, y solo escribe el texto del día.

**Por qué puede funcionar.**
- Menos errores: nombres y coordenadas correctos siempre, sin geocodificar en vivo.
- Generación más barata y rápida: el modelo recibe una lista corta de candidatos y devuelve ids.
- Datos que se acumulan: cada viaje mejora el catálogo (qué se elige, qué se descarta, qué se marca como hecho).
- SEO: una página pública por ciudad y por lugar ("Qué hacer en Kioto", "Fushimi Inari: cómo llegar, horarios") que lleva a "Armá tu viaje con esto".

**Cómo se podría implementar.**
1. **Tabla `places`:** `id`, `slug`, `city`, `country`, `name`, `local_name`, `lat`, `lng`, `kind` (atracción, comida, barrio, excursión), `area` (barrio), `duration_min`, `price_level`, `best_time` (mañana / tarde / noche), `tags`, `description`, `tips`, `source`, `verified_at`. Los pins ganan un `place_id` opcional.
2. **Sembrarlo de a poco, empezando por las ciudades que ya se usan:**
   - Opción A: cosechar lo que la IA ya genera. Cada pin geocodificado como `ok` es un candidato; se normaliza el nombre, se deduplica por cercanía (menos de 100 m y nombre parecido) y se revisa a mano.
   - Opción B: generar una lista por ciudad (las 40–60 imperdibles, por categoría) y validarla contra OpenStreetMap o Wikidata para nombre y coordenadas.
   - Wikidata o Wikipedia como fuente de descripciones e imágenes con licencia libre.
3. **Generación con catálogo:** si la ciudad tiene catálogo, el prompt recibe los candidatos (filtrados por intereses, ritmo y chicos) y responde con ids y orden. Si la ciudad no tiene catálogo, sigue como hoy.
4. **Un poco de curaduría:** una vista admin simple para aprobar o editar lugares nuevos y fusionar duplicados.
5. **Páginas públicas:** `/ciudad/kioto` y `/ciudad/kioto/fushimi-inari`, prerenderizadas (SSG o un endpoint que sirva HTML) con meta tags y datos estructurados (`TouristAttraction`), y un CTA para armar el viaje.

**Cuándo.** Cuando haya uso real en varias ciudades: con pocos viajes, la opción A no tiene volumen y conviene seguir con la IA y la geocodificación mejorada.
