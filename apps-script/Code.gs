/**
 * ENVIAMELO CALI — Backend de Google Apps Script (versión fusionada)
 * ------------------------------------------------------------
 * Hace 5 cosas:
 *  1) doGet()  -> entrega el catálogo (hoja "Productos") como JSON al sitio web
 *                 (?action=productos), el feed CSV para Meta (?action=feed)
 *                 y sirve el Panel de Administración (?page=admin).
 *  2) doPost() -> recibe los leads del sitio y los guarda en la hoja "Leads"
 *                 (con talla, color, anticipo y datos de la campaña).
 *  3) onEditInstallable() -> cuando cambias la columna "Etapa" de un lead:
 *       "Interesado/Calificado" -> envía "LeadCalificado" a Meta (CAPI)
 *       "Cerrado (ganado)"      -> envía "Purchase" a Meta (CAPI)
 *  4) Funciones del panel admin -> guardar/editar/eliminar productos y subir
 *     fotos a una carpeta de Google Drive dedicada a cada producto.
 *  5) Lectura por NOMBRE de columna: puedes agregar columnas a la hoja sin
 *     romper nada. Las columnas costo, mayorista y notas nunca se publican.
 * ------------------------------------------------------------ */

/* =========================================================
   CONFIGURA AQUÍ
   ========================================================= */
var SHEET_PRODUCTOS = "Productos";
var SHEET_LEADS = "Leads";
var DRIVE_ROOT_FOLDER_NAME = "Mercadeo Cali - Fotos";
var SITE_URL = "https://lc-mira.github.io/enviamelocali/";
var BRAND_DEFAULT = "Enviamelo Cali";
var META_API_VERSION = "v19.0"; // revisa en developers.facebook.com cuál es la vigente y actualízala aquí

// Columnas de la hoja "Productos". Las 9 primeras son las de siempre (mismo orden);
// el resto se agregan al final solas al usar el menú "Crear/ordenar hojas".
var PRODUCT_COLUMNS = [
  "id", "categoria", "subcategoria", "nombre", "talla", "precio", "disponibilidad", "icon", "Foto Producto",
  "activo", "descripcion", "tipo_talla", "tallas", "colores", "tiempo_entrega", "material", "peso_gr",
  "en_meta", "marca", "destacado", "costo", "mayorista", "notas", "precio_normal"
];

// Columnas de la hoja "Leads". Las 12 primeras son las de siempre; el resto se agregan al final.
var LEAD_COLUMNS = [
  "Fecha", "Nombre", "Celular", "Producto", "Categoria", "Subcategoria",
  "Talla", "Precio", "Etapa", "CAPI_Enviado", "Fecha_CAPI", "Pagina",
  "Color", "Cantidad", "Anticipo", "Producto_ID", "Event_ID", "FBP", "FBC",
  "UTM_Source", "UTM_Medium", "UTM_Campaign", "UTM_Content", "UTM_Term",
  "Ad_ID", "Adset_ID", "Campaign_ID", "URL", "CAPI_Compra", "Fecha_CAPI_Compra"
];

// Etapas del embudo.
var ETAPAS = [
  "Nuevo lead", "Contactado", "Interesado/Calificado",
  "Negociación", "Cerrado (ganado)", "No calificado"
];
var ETAPA_CALIFICADO = "Interesado/Calificado";
var ETAPA_GANADO = "Cerrado (ganado)";

// Qué evento de Meta se envía al llegar a cada etapa (y en qué columnas se anota).
var ETAPA_EVENTOS = {};
ETAPA_EVENTOS[ETAPA_CALIFICADO] = { evento: "LeadCalificado", colEnviado: "CAPI_Enviado", colFecha: "Fecha_CAPI" };
ETAPA_EVENTOS[ETAPA_GANADO] = { evento: "Purchase", colEnviado: "CAPI_Compra", colFecha: "Fecha_CAPI_Compra" };

// Campos del producto que el panel puede editar (el resto de columnas no se toca al guardar).
var ADMIN_FIELDS = [
  "categoria", "subcategoria", "nombre", "talla", "precio", "disponibilidad", "icon",
  "descripcion", "tipo_talla", "tallas", "colores", "tiempo_entrega", "material", "peso_gr",
  "activo", "en_meta", "marca", "destacado", "precio_normal"
];

/* =========================================================
   MENÚ — configurar credenciales y acceso sin tocar código
   ========================================================= */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Enviamelo Cali")
    .addItem("🎛️ Ver enlace del panel de administración", "mostrarEnlacePanel")
    .addItem("📣 Ver enlace del feed de Meta", "mostrarEnlaceFeed")
    .addSeparator()
    .addItem("⚙️ Configurar credenciales de Meta", "configurarCredenciales")
    .addItem("🔑 Configurar código de acceso del panel", "configurarCodigoAcceso")
    .addItem("🧪 Probar conexión con Meta (evento de prueba)", "probarConexionMeta")
    .addItem("🧰 Crear/ordenar hojas (Productos y Leads)", "inicializarHojas")
    .addToUi();
}

function mostrarEnlacePanel() {
  var ui = SpreadsheetApp.getUi();
  var url = ScriptApp.getService().getUrl();
  if (!url) {
    ui.alert("Todavía no has publicado este script como aplicación web.\n\nVe a Implementar > Nueva implementación > Aplicación web, y vuelve a intentarlo.");
    return;
  }
  var adminUrl = url + "?page=admin";
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;padding:8px">' +
    '<p>Guarda este enlace, es tu panel de carga rápida:</p>' +
    '<p style="word-break:break-all;background:#f3f3f1;padding:10px;border-radius:6px;font-size:13px">' + adminUrl + '</p>' +
    '<p style="font-size:12px;color:#666">Ábrelo desde el celular para subir fotos directo desde la cámara.</p>' +
    '</div>'
  ).setWidth(420).setHeight(200);
  ui.showModalDialog(html, "Panel de administración");
}

function mostrarEnlaceFeed() {
  var ui = SpreadsheetApp.getUi();
  var url = ScriptApp.getService().getUrl();
  if (!url) {
    ui.alert("Todavía no has publicado este script como aplicación web.");
    return;
  }
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;padding:8px">' +
    '<p>Pega este enlace en Meta (Commerce Manager > Catálogo > Fuente de datos > Programar):</p>' +
    '<p style="word-break:break-all;background:#f3f3f1;padding:10px;border-radius:6px;font-size:13px">' + url + '?action=feed</p>' +
    '<p style="font-size:12px;color:#666">Solo salen los productos activos con la columna en_meta = SI.</p>' +
    '</div>'
  ).setWidth(440).setHeight(220);
  ui.showModalDialog(html, "Feed del catálogo para Meta");
}

function configurarCredenciales() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var r1 = ui.prompt("Pixel ID de Meta", "Pégalo tal cual aparece en Events Manager:", ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var pixelId = r1.getResponseText().trim();

  var r2 = ui.prompt("Access Token de Conversions API", "Generado en Events Manager > Configuración > Conversions API:", ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var token = r2.getResponseText().trim();

  var r3 = ui.prompt("Test Event Code (opcional)", "Solo para pruebas en el Events Manager. Déjalo vacío en producción:", ui.ButtonSet.OK_CANCEL);
  var testCode = r3.getSelectedButton() === ui.Button.OK ? r3.getResponseText().trim() : "";

  props.setProperty("META_PIXEL_ID", pixelId);
  props.setProperty("META_ACCESS_TOKEN", token);
  props.setProperty("META_TEST_EVENT_CODE", testCode);

  ui.alert("Listo. Credenciales guardadas de forma segura en este proyecto.\n\nRecuerda poner el mismo Pixel ID en META_PIXEL_ID dentro de index.html del sitio.");
}

function configurarCodigoAcceso() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var actual = props.getProperty("ADMIN_ACCESS_CODE");
  var r = ui.prompt(
    "Código de acceso al panel",
    (actual ? "Ya tienes uno configurado. " : "") + "Escribe un código largo (10 o más caracteres) para entrar al panel. Evita palabras obvias:",
    ui.ButtonSet.OK_CANCEL
  );
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var code = r.getResponseText().trim();
  if (!code) { ui.alert("El código no puede estar vacío."); return; }
  props.setProperty("ADMIN_ACCESS_CODE", code);
  ui.alert("Código guardado. Úsalo para entrar al panel de administración.");
}

/* Crea las hojas y agrega las columnas que falten, sin borrar nada. Sin interfaz: sirve también desde doPost. */
function crearHojas_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var leads = ss.getSheetByName(SHEET_LEADS) || ss.insertSheet(SHEET_LEADS);
  var leadsVacia = leads.getLastRow() === 0;
  asegurarColumnas_(leads, LEAD_COLUMNS);
  if (leadsVacia) leads.setFrozenRows(1);

  var productos = ss.getSheetByName(SHEET_PRODUCTOS) || ss.insertSheet(SHEET_PRODUCTOS);
  var productosVacia = productos.getLastRow() === 0;
  asegurarColumnas_(productos, PRODUCT_COLUMNS);
  if (productosVacia) {
    productos.appendRow(["p1", "Moteros", "Trajes impermeables", "Traje impermeable siliconado", "Todas", 85000, "Disponible", "rain", "[]"]);
    productos.appendRow(["p2", "Calzado", "Dama", "Zapatilla deportiva dama", "36", 150000, "Disponible", "shoe", "[]"]);
    productos.appendRow(["p3", "Ropa", "Caballero", "Camiseta blanca básica", "M", 80000, "Disponible", "shirt", "[]"]);
    productos.setFrozenRows(1);
  }
}

function inicializarHojas() {
  crearHojas_();
  SpreadsheetApp.getUi().alert(
    "Hojas 'Productos' y 'Leads' listas (se agregaron las columnas que faltaban, sin borrar datos).\n\n" +
    "Iconos válidos: rain, vest, light, mirror, glove, shoe, shirt, hoodie, pants, helmet, bag.\n" +
    "tipo_talla válidos: calzado, ropa, guantes, unica.\n" +
    "en_meta: escribe SI solo en lo que debe ir al catálogo de Meta (déjalo vacío en réplicas)."
  );
}

/* Agrega al final los encabezados que falten (compara sin tildes ni mayúsculas). Devuelve los encabezados actuales. */
function asegurarColumnas_(sheet, cols) {
  var lastCol = sheet.getLastColumn();
  var headers = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var keys = headers.map(normHeader_);
  cols.forEach(function (c) {
    if (keys.indexOf(normHeader_(c)) === -1) {
      sheet.getRange(1, headers.length + 1).setValue(c);
      headers.push(c);
      keys.push(normHeader_(c));
    }
  });
  return headers;
}

/* =========================================================
   doGet — catálogo público, feed de Meta y panel admin
   ========================================================= */
function doGet(e) {
  var page = e && e.parameter && e.parameter.page;
  var action = e && e.parameter && e.parameter.action;

  if (page === "admin") {
    return HtmlService.createTemplateFromFile("Admin").evaluate()
      .setTitle("Panel · Enviamelo Cali")
      .addMetaTag("viewport", "width=device-width, initial-scale=1")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }

  if (action === "productos") {
    return ContentService.createTextOutput(JSON.stringify(leerProductos()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "feed") {
    return ContentService.createTextOutput(generarFeed_())
      .setMimeType(ContentService.MimeType.CSV);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true, servicio: "Enviamelo Cali API" }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Lee una hoja por nombre de columna. Devuelve [{id:..., categoria:..., _fila:n}, ...] */
function leerFilas_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var keys = values[0].map(normHeader_);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = {};
    for (var c = 0; c < keys.length; c++) {
      if (!keys[c]) continue;
      var v = values[i][c];
      r[keys[c]] = (typeof v === "string") ? v.trim() : v;
    }
    r._fila = i + 1;
    rows.push(r);
  }
  return rows;
}

function leerProductos() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PRODUCTOS);
  return leerFilas_(sheet)
    .filter(function (r) { return r.id !== undefined && String(r.id) !== "" && esActivo_(r); })
    .map(function (r) {
      var fotos = parseFotos_(r.foto_producto !== undefined ? r.foto_producto : r.fotos);
      // Lista blanca: solo estos campos salen al sitio. costo, mayorista, notas y en_meta nunca.
      return {
        id: String(r.id), categoria: r.categoria, subcategoria: r.subcategoria, nombre: r.nombre,
        descripcion: txt_(r.descripcion), talla: txt_(r.talla), tallas: txt_(r.tallas),
        tipo_talla: txt_(r.tipo_talla), colores: txt_(r.colores),
        tiempo_entrega: txt_(r.tiempo_entrega), material: txt_(r.material), peso_gr: txt_(r.peso_gr),
        destacado: txt_(r.destacado),
        precio: precio_(r.precio), precio_normal: precio_(r.precio_normal), disponibilidad: r.disponibilidad,
        icon: r.icon || "shirt",
        fotos: fotos.map(function (f) { return f.url; }), // URLs listas para el sitio público
        foto: fotos.length ? fotos[0].url : "" // compatibilidad hacia atrás
      };
    });
}

/* ---------------- Feed CSV para el catálogo de Meta ---------------- */
function generarFeed_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PRODUCTOS);
  var lines = ["id,title,description,availability,condition,price,sale_price,link,image_link,additional_image_link,brand"];
  leerFilas_(sheet).forEach(function (r) {
    if (r.id === undefined || String(r.id) === "" || !esActivo_(r)) return;
    // Lista blanca estricta: solo entra lo marcado explícitamente con SI. Vacío = excluido (réplicas).
    if (String(r.en_meta || "").trim().toUpperCase() !== "SI") return;
    var fotos = parseFotos_(r.foto_producto !== undefined ? r.foto_producto : r.fotos).map(function (f) { return f.url; });
    var precio = precio_(r.precio);
    if (!fotos.length || !precio || !r.nombre) return; // Meta exige imagen y precio
    // Con descuento: price = precio normal, sale_price = precio de hoy (Meta muestra el tachado)
    var normal = precio_(r.precio_normal);
    var enOferta = normal > precio;
    var disp = String(r.disponibilidad || "").toLowerCase();
    var availability = disp.indexOf("bajo pedido") > -1 ? "available for order" : "in stock";
    lines.push([
      r.id, r.nombre, txt_(r.descripcion) || (r.nombre + " - " + r.categoria), availability, "new",
      (enOferta ? normal : precio) + ".00 COP", enOferta ? precio + ".00 COP" : "",
      SITE_URL + "?p=" + encodeURIComponent(r.id), fotos[0], fotos.slice(1, 10).join(","),
      txt_(r.marca) || BRAND_DEFAULT
    ].map(csvCell_).join(","));
  });
  return lines.join("\n");
}

/**
 * La columna "Foto Producto" guarda un JSON: [{"url":"...","fileId":"..."}, ...]
 * También entiende el formato viejo (una o varias URLs en texto plano) para que
 * los productos que ya tenías cargados no se rompan.
 */
function parseFotos_(raw) {
  if (!raw) return [];
  var s = String(raw).trim();
  if (!s) return [];
  try {
    var arr = JSON.parse(s);
    if (!Array.isArray(arr)) arr = [arr];
    return arr.map(function (f) {
      if (typeof f === "string") return { url: f, fileId: "" };
      var url = f && f.url ? String(f.url) : (f && f.fileId ? "https://drive.google.com/thumbnail?id=" + f.fileId + "&sz=w1000" : "");
      return { url: url, fileId: (f && f.fileId) || "" };
    }).filter(function (f) { return f.url; });
  } catch (e) {
    return s.split(/[\s|]+/).filter(function (u) { return /^https:\/\//i.test(u); })
      .map(function (u) { return { url: u, fileId: "" }; }); // formato viejo: URLs en texto plano
  }
}

/* =========================================================
   doPost — recibe un lead del sitio (por nombre de columna)
   ========================================================= */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var body = JSON.parse(e.postData.contents);

    var nombre = limpiar_(body.nombre, 80);
    var celular = String(body.celular || "").replace(/\D/g, "");
    if (nombre.length < 3 || celular.length < 7 || celular.length > 12) {
      return respuestaJson_({ ok: false, error: "datos_invalidos" });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_LEADS);
    if (!sheet) { crearHojas_(); sheet = ss.getSheetByName(SHEET_LEADS); }
    var headers = asegurarColumnas_(sheet, LEAD_COLUMNS);
    var keys = headers.map(normHeader_);

    var valores = {
      fecha: new Date(), nombre: nombre, celular: celular,
      producto: limpiar_(body.producto, 300), categoria: limpiar_(body.categoria, 100),
      subcategoria: limpiar_(body.subcategoria, 100), talla: limpiar_(body.talla, 100),
      precio: Number(body.precio) || "",
      etapa: "Nuevo lead", capi_enviado: "No", pagina: limpiar_(body.pagina, 40) || "catalogo",
      color: limpiar_(body.color, 100), cantidad: Number(body.cantidad) || "", anticipo: Number(body.anticipo) || "",
      producto_id: limpiar_(body.producto_id, 100), event_id: limpiar_(body.event_id, 60),
      fbp: limpiar_(body.fbp, 100), fbc: limpiar_(body.fbc, 200),
      utm_source: limpiar_(body.utm_source, 120), utm_medium: limpiar_(body.utm_medium, 120),
      utm_campaign: limpiar_(body.utm_campaign, 120), utm_content: limpiar_(body.utm_content, 120),
      utm_term: limpiar_(body.utm_term, 120), ad_id: limpiar_(body.ad_id, 60),
      adset_id: limpiar_(body.adset_id, 60), campaign_id: limpiar_(body.campaign_id, 60),
      url: limpiar_(body.url, 300)
    };

    sheet.appendRow(keys.map(function (k) {
      var v = valores[k];
      return v === undefined ? "" : proteger_(v);
    }));

    return respuestaJson_({ ok: true });
  } catch (err) {
    return respuestaJson_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* =========================================================
   onEditInstallable — detecta cambio de Etapa y dispara CAPI
   IMPORTANTE: esta función NO se activa sola. Debes crear un
   disparador instalable (Triggers > Add trigger > onEditInstallable
   > On edit). Si ya lo tienes creado, no hace falta repetirlo.
   ========================================================= */
function onEditInstallable(e) {
  var sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_LEADS) return;

  var editedRow = e.range.getRow();
  if (editedRow === 1) return; // encabezado

  var headerRow = asegurarColumnas_(sheet, LEAD_COLUMNS);
  var keys = headerRow.map(normHeader_);
  var etapaCol = keys.indexOf("etapa") + 1;
  if (etapaCol === 0) return;

  // Solo actuamos si la columna editada fue "Etapa"
  if (e.range.getColumn() !== etapaCol) return;

  var nuevaEtapa = sheet.getRange(editedRow, etapaCol).getValue();
  var cfg = ETAPA_EVENTOS[nuevaEtapa];
  if (!cfg) return;

  var capiCol = keys.indexOf(normHeader_(cfg.colEnviado)) + 1;
  var fechaCapiCol = keys.indexOf(normHeader_(cfg.colFecha)) + 1;

  var yaEnviado = capiCol ? sheet.getRange(editedRow, capiCol).getValue() : "";
  if (yaEnviado === "Sí") return; // evita duplicados

  var rowData = sheet.getRange(editedRow, 1, 1, headerRow.length).getValues()[0];
  var lead = {};
  keys.forEach(function (k, i) { if (k) lead[k] = rowData[i]; });

  var resultado = enviarEventoCAPI(cfg.evento, lead);

  if (capiCol) {
    sheet.getRange(editedRow, capiCol).setValue(resultado.ok ? "Sí" : "Error: " + resultado.error);
  }
  if (fechaCapiCol) {
    sheet.getRange(editedRow, fechaCapiCol).setValue(new Date());
  }
}

/* =========================================================
   Envío del evento a Meta Conversions API
   `lead` usa nombres de columna en minúscula: nombre, celular, producto, ...
   ========================================================= */
function enviarEventoCAPI(eventName, lead) {
  var props = PropertiesService.getScriptProperties();
  var pixelId = props.getProperty("META_PIXEL_ID");
  var token = props.getProperty("META_ACCESS_TOKEN");
  var testCode = props.getProperty("META_TEST_EVENT_CODE");

  if (!pixelId || !token) {
    return { ok: false, error: "Faltan credenciales. Usa el menú Enviamelo Cali > Configurar credenciales de Meta." };
  }

  var celularLimpio = String(lead.celular || "").replace(/\D/g, "");
  if (celularLimpio && celularLimpio.indexOf("57") !== 0) celularLimpio = "57" + celularLimpio; // Colombia
  var partes = String(lead.nombre || "").trim().toLowerCase().split(/\s+/).filter(Boolean);

  var userData = {};
  if (celularLimpio) userData.ph = [sha256(celularLimpio)];
  if (partes.length) userData.fn = [sha256(partes[0])];
  if (partes.length > 1) userData.ln = [sha256(partes[partes.length - 1])];
  userData.country = [sha256("co")];
  // Identificadores del navegador (se guardan en el lead): mejoran el cruce con el anuncio
  if (lead.fbp) userData.fbp = String(lead.fbp);
  if (lead.fbc) userData.fbc = String(lead.fbc);

  var customData = {
    content_name: lead.producto || "",
    content_category: lead.categoria || "",
    content_type: "product",
    value: Number(lead.precio) || 0,
    currency: "COP"
  };
  var ids = String(lead.producto_id || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  if (ids.length) customData.content_ids = ids;
  if (Number(lead.cantidad)) customData.num_items = Number(lead.cantidad);

  var evento = {
    event_name: eventName,
    // Hora real del evento (no la del lead): Meta rechaza eventos con más de 7 días de antigüedad.
    event_time: Math.floor(Date.now() / 1000),
    action_source: "system_generated",
    user_data: userData,
    custom_data: customData
  };
  if (lead.event_id) evento.event_id = String(lead.event_id) + ":" + eventName;
  if (lead.url) evento.event_source_url = String(lead.url);

  var payload = { data: [evento] };
  if (testCode) payload.test_event_code = testCode;

  var url = "https://graph.facebook.com/" + META_API_VERSION + "/" + pixelId + "/events?access_token=" + encodeURIComponent(token);

  try {
    var response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      return { ok: true, response: response.getContentText() };
    }
    return { ok: false, error: "HTTP " + code + ": " + response.getContentText() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function sha256(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

/* =========================================================
   Prueba manual desde el menú
   ========================================================= */
function probarConexionMeta() {
  var ui = SpreadsheetApp.getUi();
  var leadPrueba = {
    nombre: "Prueba Enviamelo Cali", celular: "3001234567",
    producto: "Producto de prueba", categoria: "Moteros", precio: 50000
  };
  var resultado = enviarEventoCAPI("LeadCalificado", leadPrueba);
  ui.alert(resultado.ok
    ? "✅ Conexión exitosa con Meta CAPI.\n\nRevisa 'Eventos de prueba' en tu Events Manager si usaste un Test Event Code."
    : "❌ Error: " + resultado.error);
}

/* ============================================================
   PANEL DE ADMINISTRACIÓN — funciones llamadas desde Admin.html
   (google.script.run). Todas validan el código de acceso primero.
   ============================================================ */

function validarCodigo_(code) {
  var props = PropertiesService.getScriptProperties();
  var real = props.getProperty("ADMIN_ACCESS_CODE");
  if (!real) throw new Error("Primero configura un código de acceso desde el menú Enviamelo Cali > Configurar código de acceso del panel.");
  if (String(code) !== String(real)) throw new Error("Código incorrecto.");
  return true;
}

function verificarAcceso(code) {
  validarCodigo_(code);
  return { ok: true };
}

// Incluye archivos HTML parciales dentro de Admin.html (no se usa por ahora,
// pero queda disponible si luego separas el panel en varios archivos).
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function listarProductosAdmin(code) {
  validarCodigo_(code);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PRODUCTOS);
  return leerFilas_(sheet)
    .filter(function (r) { return r.id !== undefined && String(r.id) !== ""; })
    .map(function (r) {
      var p = { id: String(r.id) };
      ADMIN_FIELDS.forEach(function (k) { p[k] = (r[k] === undefined || r[k] === null) ? "" : r[k]; });
      p.precio = precio_(r.precio);
      p.talla = txt_(r.talla);
      p.icon = r.icon || "shirt";
      // [{url, fileId}, ...] completo, para poder borrar cada una
      p.fotosData = parseFotos_(r.foto_producto !== undefined ? r.foto_producto : r.fotos);
      return p;
    });
}

function guardarProducto(code, producto) {
  validarCodigo_(code);
  if (!producto || !producto.id) throw new Error("El producto necesita un ID.");

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_PRODUCTOS);
  if (!sheet) { crearHojas_(); sheet = ss.getSheetByName(SHEET_PRODUCTOS); }

  var headers = asegurarColumnas_(sheet, PRODUCT_COLUMNS);
  var keys = headers.map(normHeader_);
  var fila = buscarFilaProducto_(sheet, producto.id);

  // Si el producto ya existe se parte de su fila actual: así NO se pisan columnas
  // que el panel no maneja (costo, mayorista, notas...).
  var valores = fila > 0
    ? sheet.getRange(fila, 1, 1, headers.length).getValues()[0]
    : headers.map(function () { return ""; });

  function poner(key, val) {
    var i = keys.indexOf(key);
    if (i > -1) valores[i] = val;
  }

  poner("id", producto.id);
  ADMIN_FIELDS.forEach(function (k) {
    if (producto[k] === undefined) return; // no vino: se conserva lo que había
    poner(k, (k === "precio" || k === "precio_normal") ? (Number(producto[k]) || (k === "precio" ? 0 : "")) : String(producto[k] === null ? "" : producto[k]).trim());
  });

  if (fila <= 0) { // producto nuevo: valores por defecto
    if (!producto.disponibilidad) poner("disponibilidad", "Disponible");
    if (!producto.icon) poner("icon", "shirt");
    if (producto.activo === undefined) poner("activo", "SI");
  }

  // producto.fotos: array de {url, fileId}. Si no viene (undefined), se conserva
  // lo que ya había guardado; si viene como [] vacío, se borran todas las fotos.
  if (producto.fotos !== undefined) poner("foto_producto", JSON.stringify(producto.fotos));
  else if (fila <= 0) poner("foto_producto", "[]");

  if (fila > 0) {
    sheet.getRange(fila, 1, 1, headers.length).setValues([valores]);
  } else {
    sheet.appendRow(valores);
  }

  return { ok: true, id: producto.id };
}

function eliminarProducto(code, id) {
  validarCodigo_(code);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PRODUCTOS);
  var fila = buscarFilaProducto_(sheet, id);
  if (fila > 0) sheet.deleteRow(fila);

  try {
    var carpeta = obtenerCarpetaProducto_(id, false);
    if (carpeta) carpeta.setTrashed(true);
  } catch (e) { /* si no existe la carpeta, no pasa nada */ }

  return { ok: true };
}

function buscarFilaProducto_(sheet, id) {
  if (!sheet || sheet.getLastRow() < 2) return -1;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

/* =========================================================
   Fotos en Google Drive — una carpeta por ID de producto
   ========================================================= */

function obtenerCarpetaRaiz_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("DRIVE_ROOT_FOLDER_ID");
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* se recrea abajo */ }
  }
  var folders = DriveApp.getFoldersByName(DRIVE_ROOT_FOLDER_NAME);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(DRIVE_ROOT_FOLDER_NAME);
  props.setProperty("DRIVE_ROOT_FOLDER_ID", folder.getId());
  return folder;
}

function obtenerCarpetaProducto_(id, crear) {
  var raiz = obtenerCarpetaRaiz_();
  var carpetas = raiz.getFoldersByName(String(id));
  if (carpetas.hasNext()) return carpetas.next();
  if (crear === false) return null;
  return raiz.createFolder(String(id));
}

/**
 * Sube UNA foto (base64) a la carpeta Drive del producto y devuelve su URL.
 * Se puede llamar varias veces para el mismo producto: cada foto queda
 * guardada por separado (no reemplaza las anteriores).
 */
function subirFotoProducto(code, id, base64Data, mimeType, filename) {
  validarCodigo_(code);
  if (!id) throw new Error("Falta el ID del producto.");

  var carpeta = obtenerCarpetaProducto_(id, true);

  var datos = base64Data.indexOf(",") > -1 ? base64Data.split(",")[1] : base64Data;
  var nombreUnico = (filename || "foto") + "_" + new Date().getTime() + ".jpg";
  var blob = Utilities.newBlob(Utilities.base64Decode(datos), mimeType || "image/jpeg", nombreUnico);
  var archivo = carpeta.createFile(blob);
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var url = "https://drive.google.com/thumbnail?id=" + archivo.getId() + "&sz=w1000";
  return { ok: true, url: url, fileId: archivo.getId() };
}

/**
 * Elimina (envía a la papelera) un archivo de foto específico en Drive.
 * Se usa cuando quitas una foto individual desde el panel.
 */
function eliminarFotoDrive(code, fileId) {
  validarCodigo_(code);
  if (!fileId) return { ok: true };
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) { /* si ya no existe, no pasa nada */ }
  return { ok: true };
}

/* =========================================================
   Utilidades
   ========================================================= */
function normHeader_(h) {
  return String(h === undefined || h === null ? "" : h).toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function esActivo_(r) {
  if (r.activo === undefined || r.activo === "" || r.activo === null) return true;
  return !/^(no|false|0)$/i.test(String(r.activo).trim());
}

function precio_(v) {
  return Number(String(v === undefined || v === null ? "" : v).replace(/[^\d]/g, "")) || 0;
}

function txt_(v) {
  return (v === undefined || v === null) ? "" : String(v).trim();
}

function limpiar_(v, max) {
  return String(v === undefined || v === null ? "" : v).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max || 200);
}

/* Evita que un texto escrito por un visitante se interprete como fórmula en la hoja */
function proteger_(v) {
  return (typeof v === "string" && /^[=+\-@]/.test(v)) ? "'" + v : v;
}

function csvCell_(v) {
  var s = String(v === undefined || v === null ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function respuestaJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
