# Control de entregas

Panel interno de Baterías Volta con dos partes:

- **Llamadas Clientes**: consulta los pedidos de Amazon y el estado de los envíos en Correos Express, y saca la lista (y el PDF) de clientes a los que hay que llamar porque su envío no llega.
- **Control de Llamadas**: compara esa lista con las llamadas registradas en Ringover para ver a quién se ha llamado de verdad.

## Cómo está montado

| Pieza | Dónde | Qué hace |
|---|---|---|
| Página | `public/index.html` + `public/pdf-lib.min.js` | Todo el panel. Los ficheros que se cargan se leen en el navegador. |
| Servidor | `netlify/functions/api.mjs` + `lib/core.mjs` | Atiende `/api/*`: comprueba la contraseña, lanza los escenarios de Make, lee sus resultados y guarda las marcas de «llamado». |
| Make | Escenarios «LLAMADAS AMAZON» y «LLAMADAS AMAZON - Control Ringover» | Son los que hablan con Amazon, Correos Express y Ringover. Las claves de esos servicios están dentro de Make, no aquí. |

Este repositorio **no contiene claves ni datos de clientes**. Los datos de ejemplo que muestra la página al abrirla son inventados.

## Desplegar en Netlify

1. En Netlify: **Add new site → Import an existing project** y elige este repositorio. No hay que tocar los ajustes de build: los lee de `netlify.toml`.
2. En **Site configuration → Environment variables** añade:

   | Variable | Valor |
   |---|---|
   | `APP_PASSWORD` | La contraseña con la que se entra al panel. Que sea larga: es lo único que protege los datos de los clientes. |
   | `MAKE_API_TOKEN` | Un token de API de Make (ver abajo). |
   | `MAKE_ZONE` | Opcional. Por defecto `eu2.make.com`. |

3. Lanza un despliegue nuevo (**Deploys → Trigger deploy**) para que coja las variables.

### Token de Make

En Make: **perfil → API access → Add token**, con estos permisos:

- `scenarios:read`
- `scenarios:run`
- `datastores:read`

El servidor solo puede lanzar los dos escenarios del panel y leer sus tres almacenes de datos (los identificadores están en `lib/core.mjs`).

## Seguridad

- Sin la contraseña, `/api` no devuelve nada ni lanza nada en Make.
- La contraseña es compartida por todo el equipo. Si alguien deja la empresa, cámbiala en Netlify y vuelve a desplegar.
- La página pide a los buscadores que no la indexen, pero la dirección es pública: no la compartas fuera del equipo.

## Probar

```
npm test
```

Comprueba el servidor (`lib/core.mjs`) con Make simulado. La conexión real con Make solo se puede probar con el sitio desplegado y el token puesto.
