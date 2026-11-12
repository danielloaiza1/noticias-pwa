# Noticias (PWA)

Barranquilla, Colombia, Países Bajos y el mundo en una sola app instalable.

## Cómo funciona

- `scripts/fetch_news.py` descarga los feeds RSS de `sources.json` y genera `site/news.json`.
- `site/` es la PWA (HTML + JS sin dependencias). Lee `news.json`, funciona sin conexión con la última copia y se instala en la pantalla de inicio.
- `.github/workflows/update.yml` ejecuta el script cada 30 min y publica `site/` en GitHub Pages (sin commits automáticos).

## Puesta en marcha (una vez)

1. Crea un repositorio en GitHub (público, para usar Pages gratis) y sube el contenido de esta carpeta a la rama `main`.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. En la pestaña **Actions**, abre "Actualizar noticias y publicar" y pulsa **Run workflow**. En ~1 minuto la URL aparece en el job `deploy` (normalmente `https://TU-USUARIO.github.io/NOMBRE-REPO/`).
4. En el iPhone: abre esa URL en **Safari → Compartir → Añadir a pantalla de inicio**. En Android/Chrome: menú → *Instalar app*.

## Personalizar fuentes

Edita `sources.json` (nombre, sección, idioma, URL del feed) y haz commit. Las fuentes que fallen se marcan en rojo en el desplegable "Fuentes" al pie de la app. Para añadir una sección, agrégala en `sections` y úsala en `section`.

Notas:
- Las entradas "Google Noticias" usan RSS de búsqueda de Google Noticias (por ejemplo, `site:elheraldo.co`), útil para medios sin feed propio.
- NOS (feed en neerlandés) se muestra solo con titular y enlace, como piden sus condiciones de uso de RSS para uso personal.

## Probar en local

```
python3 scripts/fetch_news.py
cd site && python3 -m http.server 8000   # abre http://localhost:8000
```
