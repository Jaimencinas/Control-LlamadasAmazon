// Servidor del panel «Control de entregas».
// Hace de puente entre la página y Make (con el token guardado en Netlify) y guarda las marcas de «llamado».
// No depende de Netlify: recibe las variables de entorno, fetch y el almacén, para poder probarlo aparte.
import { createHash, timingSafeEqual } from 'node:crypto';

// Solo se pueden lanzar estos escenarios y leer estos almacenes de Make.
export const ESCENARIOS = new Set([9918565, 9925738]);   // LLAMADAS AMAZON · LLAMADAS AMAZON - Control Ringover
export const ALMACENES = new Set([192885, 192908, 193318]); // Correos Express · pedidos Amazon · llamadas Ringover
const COLECCIONES = ['llamados', 'listas'];

const json = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const error = (status, code, message) => json(status, { code, message });
const espera = ms => new Promise(r => setTimeout(r, ms));
const huella = s => createHash('sha256').update(String(s)).digest();
const claveCorrecta = (dada, buena) => typeof dada === 'string' && dada.length > 0 && timingSafeEqual(huella(dada), huella(buena));

// La respuesta de Make sobre una ejecución se reduce a lo que la página entiende:
// { eventType: 'EXECUTION_START' } mientras sigue en marcha, o { eventType: 'EXECUTION_END', status: 1|2|3 } al terminar.
export function normalizarEjecucion(j) {
  const e = j && (j.scenarioLog || j.execution || j.result || j);
  if (!e || typeof e !== 'object') return null;
  let st = e.status;
  if (typeof st === 'string') {
    const u = st.trim().toUpperCase();
    st = /^(1|SUCCESS|SUCCEEDED|OK|COMPLETED|FINISHED)$/.test(u) ? 1 : /^(2|WARNING)$/.test(u) ? 2 : /^(3|ERROR|FAILED|FAILURE)$/.test(u) ? 3 : null;
  }
  if (st === 1 || st === 2 || st === 3) return { eventType: 'EXECUTION_END', status: st, error: e.error ? { message: String(e.error.message || e.error.name || 'error') } : undefined };
  if (e.eventType === 'EXECUTION_END') return { eventType: 'EXECUTION_END', status: 1 };
  return { eventType: 'EXECUTION_START' };
}

// Solo texto corto en los datos de entrada de un escenario.
function entradas(data) {
  const o = {};
  Object.keys(data && typeof data === 'object' ? data : {}).slice(0, 8).forEach(k => { const v = data[k]; if (typeof v === 'string' && v.length <= 200 && /^[\w-]{1,30}$/.test(k)) o[k] = v; });
  return o;
}

// Un documento de marcas: { e: { nºEnvío: ms | { t: ms, es: 'estado' } } }
function limpio(body) {
  const e = {}, src = body && typeof body === 'object' && body.e && typeof body.e === 'object' ? body.e : {};
  Object.keys(src).slice(0, 2000).forEach(k => {
    if (!/^\d{6,24}$/.test(k)) return; const v = src[k];
    if (typeof v === 'number' && isFinite(v)) e[k] = v;
    else if (v && typeof v === 'object') e[k] = { t: +v.t || 0, es: String(v.es || '').slice(0, 160) };
  });
  return { e };
}

export function crearApi({ env, fetch, store, ahora = () => Date.now() }) {
  async function make(tool, input) {
    const token = env.MAKE_API_TOKEN;
    if (!token) return error(500, 'config', 'Falta la variable MAKE_API_TOKEN en Netlify.');
    const base = 'https://' + (env.MAKE_ZONE || 'eu2.make.com') + '/api/v2';
    const pedir = async (ruta, init = {}) => {
      const r = await fetch(base + ruta, Object.assign({}, init, { headers: { authorization: 'Token ' + token, 'content-type': 'application/json', accept: 'application/json' } }));
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
      return { r, j };
    };
    const falloMake = ({ r, j }) => r.status === 401 || r.status === 403
      ? error(502, 'tool_error', 'Make ha rechazado el token (revisa MAKE_API_TOKEN y sus permisos)')
      : error(502, 'tool_error', String((j && (j.detail || j.message || (j.error && j.error.message))) || 'error ' + r.status).slice(0, 300));
    input = input && typeof input === 'object' ? input : {};

    if (tool === 'scenarios_run') {
      const id = +input.scenarioId; if (!ESCENARIOS.has(id)) return error(400, 'bad_request', 'Escenario no permitido.');
      const x = await pedir(`/scenarios/${id}/run`, { method: 'POST', body: JSON.stringify({ data: entradas(input.data), responsive: false }) });
      if (!x.r.ok) return falloMake(x);
      return json(200, { payload: { executionId: (x.j && x.j.executionId) || null } });
    }
    if (tool === 'executions_get') {
      const id = +input.scenarioId, ex = String(input.executionId || '');
      if (!ESCENARIOS.has(id) || !/^[0-9a-f]{32}$/.test(ex)) return error(400, 'bad_request', 'Ejecución no válida.');
      // Primero la dirección de estado de la ejecución; si no aclara nada, el registro del escenario.
      let n = null;
      for (const ruta of [`/scenarios/${id}/executions/${ex}`, `/scenarios/${id}/logs/${ex}`]) {
        const x = await pedir(ruta);
        if (x.r.status === 401 || x.r.status === 403) return falloMake(x);
        if (x.r.ok) { n = normalizarEjecucion(x.j); if (n && n.eventType === 'EXECUTION_END') break; }
      }
      return json(200, { payload: n || { eventType: 'EXECUTION_START' } });
    }
    if (tool === 'data-store-records_list') {
      const id = +input.dataStoreId; if (!ALMACENES.has(id)) return error(400, 'bad_request', 'Almacén no permitido.');
      const limite = Math.min(100, Math.max(1, +input.limit || 100));
      const x = await pedir(`/data-stores/${id}/data?pg%5Blimit%5D=${limite}`);
      if (!x.r.ok) return falloMake(x);
      return json(200, { payload: (x.j && x.j.records) || [] });
    }
    return error(400, 'bad_request', 'Operación no permitida.');
  }

  async function datos(b) {
    const st = store();
    const leer = async c => { try { return (await st.get(c, { type: 'json' })) || {}; } catch (e) { return {}; } };
    const todo = async () => { const o = {}; for (const c of COLECCIONES) o[c] = await leer(c); return o; };
    if (b.op === 'todo') return json(200, { datos: await todo() });
    if (!COLECCIONES.includes(b.col) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.id || ''))) return error(400, 'bad_request', 'Documento no válido.');
    const doc = await leer(b.col);
    if (b.op === 'borrar') delete doc[b.id];
    else if (b.op === 'set') doc[b.id] = limpio(b.body);
    else if (b.op === 'merge') { const n = limpio(b.body), a = doc[b.id] && doc[b.id].e ? doc[b.id].e : {}; doc[b.id] = { e: Object.assign({}, a, n.e) }; }
    else return error(400, 'bad_request', 'Operación no válida.');
    // Lo de hace más de 90 días ya no hace falta.
    const lim = new Date(ahora() - 90 * 86400000).toISOString().slice(0, 10);
    Object.keys(doc).forEach(k => { if (k < lim) delete doc[k]; });
    await st.setJSON(b.col, doc);
    return json(200, { datos: await todo() });
  }

  return async function api(req) {
    try {
      if (req.method !== 'POST') return error(405, 'bad_request', 'Solo POST.');
      const ruta = new URL(req.url).pathname.replace(/^\/(\.netlify\/functions\/api|api)\/?/, '').replace(/\/+$/, '');
      if (!env.APP_PASSWORD) return error(500, 'config', 'Falta la variable APP_PASSWORD en Netlify.');
      const texto = await req.text(); if (texto.length > 400000) return error(413, 'bad_request', 'Petición demasiado grande.');
      let b = {}; try { b = JSON.parse(texto || '{}') || {}; } catch (e) { return error(400, 'bad_request', 'Petición no válida.'); }
      if (!claveCorrecta(b.clave, env.APP_PASSWORD)) { await espera(env.SIN_ESPERA ? 0 : 700); return error(401, 'clave', 'Contraseña incorrecta.'); }
      if (ruta === 'sesion') return json(200, { ok: true, make: !!env.MAKE_API_TOKEN });
      if (ruta === 'make') return await make(String(b.tool || ''), b.input);
      if (ruta === 'datos') return await datos(b);
      return error(404, 'bad_request', 'No existe.');
    } catch (e) {
      return error(502, 'server_unavailable', 'El servidor del panel ha fallado: ' + String((e && e.message) || e).slice(0, 200));
    }
  };
}
