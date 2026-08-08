# Pitoviento · Pitolero Wind Lab v2

Prototipo web para explorar el comportamiento orográfico del viento en el Pico Pitolero (Cabezabellosa, Cáceres).

## Qué hace

- Terreno 3D real usando el servicio XYZ oficial de elevaciones del IGN/CNIG, basado en MDT05 LiDAR.
- Ortofoto PNOA de máxima actualidad como capa base.
- Navegación 3D tipo globo/mapa: zoom, inclinación y rotación.
- Dirección de viento meteorológica 0–359°, velocidad y estabilidad atmosférica.
- Líneas de flujo 3D coloreadas por ascendencia, descendencia y posible estela/rotor.
- Partículas animadas sobre las líneas de flujo.
- Lectura de elevación y componente vertical orográfica estimada al mover el cursor.
- Área de estudio inicial de 40 × 40 km alrededor de 40.13618392931326, -5.979353098143796.

## Cómo abrirlo

Abre `index.html` en un navegador moderno con conexión a Internet. Las librerías y las teselas del IGN se cargan en línea.

Si el navegador bloquea peticiones al abrir desde `file://`, sirve la carpeta con un servidor local, por ejemplo:

```bash
python -m http.server 8080
```

Y abre `http://localhost:8080/`.

## Fuentes

- MDT05 / Raster DEM: IGN/CNIG, CC BY 4.0 scne.es.
- PNOA máxima actualidad: IGN/CNIG.
- MapLibre GL JS para terreno 3D.
- deck.gl para las trayectorias y partículas 3D.

## Limitación física

El campo de viento es un modelo diagnóstico y exploratorio basado en pendiente, orientación, velocidad, estabilidad y una parametrización simple de estela. No es CFD, no resuelve Navier–Stokes y no debe usarse como única fuente para decisiones de seguridad de vuelo.

## Siguiente iteración prevista

Incorporar MDT50cm de tercera cobertura PNOA-LiDAR como nivel de detalle local alrededor de despegues y crestas, y separar explícitamente las capas de barlovento, sotavento, Venturi y rotor.

## Estructura

- `index.html`: interfaz principal.
- `style.css`: estilos de la aplicación.
- `app.js`: mapa 3D, terreno y modelo de viento.
