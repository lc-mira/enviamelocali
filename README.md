# Enviamelo Cali — catálogo de ventas

Sitio estático (GitHub Pages) que muestra el catálogo desde Google Sheets y lleva al cliente a WhatsApp, donde se cierra la venta con un anticipo de separación.

- `index.html` — la página completa (HTML + CSS + JS, sin dependencias).
- `apps-script/Code.gs` — API de la hoja: catálogo, feed para Meta y registro de leads.

## Configuración (en `index.html`, objeto `CONFIG`)

| Valor | Qué es |
|---|---|
| `WHATSAPP_NUMBER` | Número en formato internacional, sin `+` |
| `META_PIXEL_ID` | ID del Pixel de Meta. Vacío = no se carga el Pixel |
| `SHEET_API_URL` | URL del Web App de Apps Script |
| `ANTICIPO` | Anticipo fijo en COP (hoy 20000). Se descuenta del total |
| `SITE_URL` | URL pública del sitio |

## Hoja de cálculo — pestaña `Productos`

Las columnas actuales (`id`, `categoria`, `subcategoria`, `nombre`, `talla`, `precio`, `disponibilidad`, `icon`, `Foto Producto`) siguen funcionando. Las siguientes son opcionales y se agregan en la fila 1:

| Columna | Valores |
|---|---|
| `activo` | `SI` / `NO`. `NO` oculta el producto sin borrarlo |
| `descripcion` | Texto corto |
| `tipo_talla` | `calzado`, `ropa`, `guantes`, `anillo`, `cadena` o `unica` |
| `tallas` | Lista separada por coma: `36, 37, 38`. Con stock: `36:2, 37:0` (`:0` = agotada) |
| `colores` | `Negro, Blanco` |
| `tiempo_entrega` | `3 a 5 días` (se muestra en los "bajo pedido") |
| `material`, `peso_gr` | Para joyas: `Plata 925`, `4.5` |
| `en_meta` | `SI` solo para lo que debe ir al catálogo de Meta. Vacío = excluido |
| `marca` | Opcional, solo para el feed de Meta |
| `destacado` | `SI` para mostrarlo en la fila "Más pedidos" y en el banner de la portada |
| `costo`, `mayorista`, `notas` | Privadas. El script nunca las publica |

`disponibilidad`: `Disponible`, `Agotándose` o `Bajo pedido`.

Si `tallas` va vacía, se usa la escala estándar del `tipo_talla` (calzado 35–44, ropa XS–XXL, guantes S–XL, anillo 6–12, cadena 40–60 cm).

**Réplicas:** dejar `en_meta` vacío y nombres sin marca.

**Fotos:** la columna `Foto Producto` (JSON de Drive) se lee tal cual. Los archivos de Drive deben estar compartidos como "Cualquier persona con el enlace".

## Publicar o actualizar el Apps Script

El proyecto de Apps Script tiene dos archivos, y ambos están en `apps-script/`: `Code.gs` y `Admin.html` (el panel de carga de productos). Son versiones ampliadas de los que ya estaban en la hoja: conservan el panel, la subida de fotos a Drive, el menú y el envío a Meta.

1. Haz una copia de seguridad: en la hoja, Archivo → Hacer una copia.
2. En la hoja: Extensiones → Apps Script. Reemplaza el contenido de `Code.gs` y de `Admin.html` por los de `apps-script/`. Las credenciales de Meta, el código del panel y el disparador "al editar" quedan guardados aparte y no se pierden.
3. Guarda, recarga la hoja y usa el menú Enviamelo Cali → "Crear/ordenar hojas". Agrega las columnas nuevas al final sin borrar datos.
4. Implementar → Administrar implementaciones → ícono de lápiz → Versión: **Nueva versión** → Implementar. Así la URL no cambia.
5. Prueba en el navegador: `URL?action=productos` debe mostrar el JSON, y `URL?page=admin` abre el panel.

## Embudo y eventos a Meta

En la hoja Leads, al cambiar la columna `Etapa`:

| Etapa | Evento enviado a Meta |
|---|---|
| Interesado/Calificado | `LeadCalificado` (columnas `CAPI_Enviado`, `Fecha_CAPI`) |
| Cerrado (ganado) | `Purchase` con el valor del pedido (columnas `CAPI_Compra`, `Fecha_CAPI_Compra`) |

El evento `Purchase` es el que permite pedirle a Meta que optimice los anuncios por ventas reales. Cada evento se envía una sola vez por lead. La versión de la API de Meta está en la constante `META_API_VERSION` al inicio de `Code.gs`.

## Feed de Meta (Fase 2)

`URL?action=feed` devuelve un CSV con solo los productos `en_meta = SI`. Se carga en Commerce Manager como fuente de datos programada. Los enlaces de productos usan `?p=ID`, y el Pixel envía el mismo `id` en `content_ids`.

## Diseño y marca

Marca **Enviamelo Cali**: rojo `#D71920`, grafito `#17181B` y blanco. El verde se usa solo para los botones de WhatsApp. Los colores están al inicio del CSS de `index.html` (`:root`).

Las fotos con fondo blanco se muestran completas (sin recortar) sobre una tarjeta gris claro (`--tile`, `#EDEEF0`) con `mix-blend-mode: multiply`, así el blanco de la foto se funde con la tarjeta. Si algún día el gris no te gusta, se cambia en `--tile`.

Enlaces para anuncios: `?c=Moteros` abre el catálogo ya filtrado por esa categoría, y `?p=ID` abre directamente un producto.

## Medición

Eventos del Pixel: `PageView`, `ViewContent`, `AddToCart`, `Lead`, `Contact`. Los parámetros `utm_*`, `fbclid`, `ad_id`, `adset_id` y `campaign_id` se guardan en cada lead y se anexa una referencia al mensaje de WhatsApp. Para los anuncios, usa esta plantilla de parámetros de URL:

`utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&ad_id={{ad.id}}&adset_id={{adset.id}}&campaign_id={{campaign.id}}`
