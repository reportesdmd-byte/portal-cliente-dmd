# Portal Cliente DMD 2.0

Frontend independiente del portal de pedidos para farmacias de DMD Distribuidora.
Sitio estático (HTML/CSS/JS vanilla) que consume el API del backend MV4 (Google Apps Script).

## Archivos
- `config.js` — URL del API y parámetros comerciales. **Aquí se cambia dev → producción.**
- `api.js` — cliente HTTP del doPost + manejo de sesión.
- `app.js` — lógica de la aplicación (catálogo, carrito, quick-order, pedidos, listas).
- `styles.css` — design system DMD (verde bosque + papel + oro).
- `index.html` — estructura de pantallas.

## Despliegue
Cualquier hosting estático (GitHub Pages, Vercel). No requiere build.

## Entornos
- DEV: config.js apunta al deploy de prueba; muestra el banner "AMBIENTE DE PRUEBA".
- PROD: cambiar `API_URL` y `AMBIENTE: "PROD"` el día del corte.
