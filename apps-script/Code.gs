/**
 * Mercadeo Cali — API de la hoja de cálculo
 *
 * Endpoints (misma URL del Web App):
 *   GET  ?action=productos  → JSON con los productos activos (solo campos públicos)
 *   GET  ?action=feed       → CSV para el catálogo de Meta (solo filas con en_meta = SI)
 *   POST (JSON)             → guarda un lead en la pestaña "Leads"
 *
 * Los encabezados de la hoja se leen sin importar mayúsculas, tildes ni espacios
 * ("Foto Producto" = foto_producto). Las columnas costo, mayorista y notas
 * NUNCA se envían: solo se publica la lista blanca de abajo.
 */

var SHEET_PRODUCTOS = 'Productos';
var SHEET_LEADS = 'Leads';
var SITE_URL = 'https://lc-mira.github.io/enviamelocali/';
var BRAND_DEFAULT = 'Mercadeo Cali';

/* Campos que sí pueden salir hacia la página */
var PUBLIC_FIELDS = [
  'id', 'categoria', 'subcategoria', 'nombre', 'descripcion', 'precio',
  'disponibilidad', 'tiempo_entrega', 'tipo_talla', 'tallas', 'talla',
  'colores', 'material', 'peso_gr', 'icon'
];

/* ---------------- GET ---------------- */
function doGet(e) {
  var action = String((e && e.parameter && e.parameter.action) || 'productos').toLowerCase();
  try {
    if (action === 'productos') return json_(getProductos_());
    if (action === 'feed') return csv_(getFeed_());
    return json_({ error: 'accion_no_valida' });
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

function getProductos_() {
  return readProductRows_().filter(function (r) { return isActive_(r); }).map(function (r) {
    var out = {};
    PUBLIC_FIELDS.forEach(function (k) {
      if (r[k] !== undefined && r[k] !== '') out[k] = r[k];
    });
    out.fotos = parsePhotos_(r.fotos || r.foto || r.foto_producto);
    return out;
  });
}

/* ---------------- Feed para Meta ---------------- */
function getFeed_() {
  var header = ['id', 'title', 'description', 'availability', 'condition', 'price',
                'link', 'image_link', 'additional_image_link', 'brand'];
  var lines = [header.join(',')];
  readProductRows_().forEach(function (r) {
    if (!isActive_(r)) return;
    // Lista blanca estricta: solo entra lo marcado explícitamente con SI.
    if (String(r.en_meta || '').trim().toUpperCase() !== 'SI') return;
    var photos = parsePhotos_(r.fotos || r.foto || r.foto_producto);
    var precio = Number(r.precio) || 0;
    if (!photos.length || !precio) return; // Meta exige imagen y precio
    var avail = String(r.disponibilidad || '').toLowerCase();
    var availability = avail.indexOf('bajo pedido') > -1 ? 'available for order' : 'in stock';
    var desc = r.descripcion || (r.nombre + ' - ' + r.categoria);
    lines.push([
      r.id, r.nombre, desc, availability, 'new', precio + '.00 COP',
      SITE_URL + '?p=' + encodeURIComponent(r.id),
      photos[0], photos.slice(1, 10).join(','),
      r.marca || BRAND_DEFAULT
    ].map(csvCell_).join(','));
  });
  return lines.join('\n');
}

/* ---------------- POST: leads ---------------- */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var nombre = clean_(data.nombre, 80);
    var celular = String(data.celular || '').replace(/\D/g, '');
    if (nombre.length < 3 || celular.length < 7 || celular.length > 12) {
      return json_({ ok: false, error: 'datos_invalidos' });
    }
    data.nombre = nombre;
    data.celular = celular;

    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_LEADS);
    if (!sh) sh = SpreadsheetApp.getActive().insertSheet(SHEET_LEADS);
    if (sh.getLastRow() === 0) sh.appendRow(['fecha', 'nombre', 'celular', 'producto']);

    var lastCol = sh.getLastColumn();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var keys = headers.map(function (h) { return normHeader_(h); });

    // Agrega al final las columnas que falten (mantiene las que ya existen)
    Object.keys(data).forEach(function (k) {
      var nk = normHeader_(k);
      if (nk && keys.indexOf(nk) === -1) {
        sh.getRange(1, keys.length + 1).setValue(nk);
        keys.push(nk);
      }
    });

    var byKey = {};
    Object.keys(data).forEach(function (k) { byKey[normHeader_(k)] = data[k]; });
    var row = keys.map(function (k) {
      var v = byKey[k];
      if (v === undefined || v === null) return '';
      v = clean_(v, 300);
      // Evita que una celda se interprete como fórmula
      return /^[=+\-@]/.test(v) ? "'" + v : v;
    });
    sh.appendRow(row);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ---------------- Utilidades ---------------- */
function readProductRows_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_PRODUCTOS) || SpreadsheetApp.getActive().getSheets()[0];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var keys = values[0].map(normHeader_);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = {}, empty = true;
    for (var c = 0; c < keys.length; c++) {
      if (!keys[c]) continue;
      var v = values[i][c];
      if (v !== '' && v !== null) empty = false;
      r[keys[c]] = (typeof v === 'string') ? v.trim() : v;
    }
    if (empty || !r.nombre) continue;
    if (r.id === undefined || r.id === '') r.id = 'fila' + (i + 1);
    r.id = String(r.id);
    r.precio = Number(String(r.precio === undefined ? '' : r.precio).replace(/[^\d]/g, '')) || 0;
    rows.push(r);
  }
  return rows;
}

function isActive_(r) {
  if (r.activo === undefined || r.activo === '') return true;
  return !/^(no|false|0)$/i.test(String(r.activo).trim());
}

/* La columna de fotos puede ser JSON [{url,fileId}], URLs separadas por | o saltos de línea, o un fileId de Drive */
function parsePhotos_(raw) {
  var out = [];
  function add(u) {
    u = String(u || '').trim();
    if (/^https:\/\//i.test(u) && out.indexOf(u) === -1) out.push(u);
  }
  function walk(v) {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') {
      if (v.url) add(v.url);
      else if (v.fileId) add('https://drive.google.com/thumbnail?id=' + v.fileId + '&sz=w1000');
      return;
    }
    var s = String(v).trim();
    if (!s) return;
    if (s.charAt(0) === '[' || s.charAt(0) === '{') {
      try { walk(JSON.parse(s)); return; } catch (e) {}
    }
    s.split(/[\s|]+/).forEach(add);
  }
  walk(raw);
  return out;
}

function normHeader_(h) {
  return String(h || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function clean_(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max || 200);
}

function csvCell_(v) {
  var s = String(v === undefined || v === null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function csv_(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.CSV);
}
