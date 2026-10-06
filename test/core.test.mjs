import test from 'node:test';
import assert from 'node:assert/strict';
import { crearApi, normalizarEjecucion } from '../lib/core.mjs';

function montar(respuestas = {}) {
  const blobs = new Map(), llamadas = [];
  const store = () => ({ get: async k => (blobs.has(k) ? JSON.parse(blobs.get(k)) : null), setJSON: async (k, v) => { blobs.set(k, JSON.stringify(v)); } });
  const fetchFalso = async (url, init) => { llamadas.push([init && init.method || 'GET', url, init && init.body, init.headers.authorization]); const r = Object.entries(respuestas).find(([k]) => url.includes(k)); const [status, body] = r ? r[1] : [404, {}]; return new Response(JSON.stringify(body), { status }); };
  const env = { APP_PASSWORD: 'contraseña-larga', MAKE_API_TOKEN: 'tok', SIN_ESPERA: '1' };
  const api = crearApi({ env, fetch: fetchFalso, store, ahora: () => Date.UTC(2026, 9, 6) });
  const pedir = async (ruta, cuerpo, clave = 'contraseña-larga') => { const r = await api(new Request('https://x.test/api/' + ruta, { method: 'POST', body: JSON.stringify(Object.assign({ clave }, cuerpo)) })); return [r.status, await r.json()]; };
  return { pedir, llamadas, env, blobs };
}

test('sin contraseña correcta no hay acceso', async () => {
  const { pedir, llamadas } = montar();
  assert.equal((await pedir('sesion', {}, 'mala'))[0], 401);
  assert.equal((await pedir('make', { tool: 'scenarios_run', input: { scenarioId: 9918565 } }, ''))[0], 401);
  assert.equal((await pedir('datos', { op: 'todo' }, null))[0], 401);
  assert.equal(llamadas.length, 0);
  assert.deepEqual(await pedir('sesion', {}), [200, { ok: true, make: true }]);
});

test('solo los escenarios y almacenes del panel', async () => {
  const { pedir, llamadas } = montar({ '/run': [200, { executionId: 'a'.repeat(32) }], '/data': [200, { records: [{ key: 'k', data: { tipo: 'lista' } }] }] });
  assert.equal((await pedir('make', { tool: 'scenarios_run', input: { scenarioId: 123 } }))[0], 400);
  assert.equal((await pedir('make', { tool: 'data-store-records_list', input: { dataStoreId: 152571 } }))[0], 400);
  assert.equal((await pedir('make', { tool: 'scenarios_delete', input: { scenarioId: 9918565 } }))[0], 400);
  assert.equal(llamadas.length, 0);
  const [st, j] = await pedir('make', { tool: 'scenarios_run', input: { scenarioId: 9918565, responsive: true, data: { fechas: '2026-10-05,2026-10-06', hoy: '2026-10-06', raro: { a: 1 } } } });
  assert.equal(st, 200); assert.equal(j.payload.executionId, 'a'.repeat(32));
  assert.equal(llamadas[0][0], 'POST'); assert.match(llamadas[0][1], /eu2\.make\.com\/api\/v2\/scenarios\/9918565\/run$/); assert.equal(llamadas[0][3], 'Token tok');
  assert.deepEqual(JSON.parse(llamadas[0][2]), { data: { fechas: '2026-10-05,2026-10-06', hoy: '2026-10-06' }, responsive: false });
  const [s2, j2] = await pedir('make', { tool: 'data-store-records_list', input: { dataStoreId: 192885, limit: 5000 } });
  assert.equal(s2, 200); assert.equal(j2.payload.length, 1); assert.match(llamadas[1][1], /data-stores\/192885\/data\?pg%5Blimit%5D=100$/);
});

test('estado de la ejecución, en los formatos que puede dar Make', async () => {
  assert.deepEqual(normalizarEjecucion({ status: 'RUNNING' }), { eventType: 'EXECUTION_START' });
  assert.equal(normalizarEjecucion({ status: 'SUCCESS', outputs: {} }).status, 1);
  assert.equal(normalizarEjecucion({ scenarioLog: { eventType: 'EXECUTION_END', status: 3, error: { message: 'x' } } }).error.message, 'x');
  assert.deepEqual(normalizarEjecucion({ eventType: 'EXECUTION_START' }), { eventType: 'EXECUTION_START' });
  const ex = 'b'.repeat(32);
  let m = montar({ ['/executions/' + ex]: [200, { status: 'RUNNING' }], ['/logs/' + ex]: [200, { scenarioLog: { eventType: 'EXECUTION_START' } }] });
  assert.deepEqual((await m.pedir('make', { tool: 'executions_get', input: { scenarioId: 9918565, executionId: ex } }))[1].payload, { eventType: 'EXECUTION_START' });
  m = montar({ ['/executions/' + ex]: [404, {}], ['/logs/' + ex]: [200, { scenarioLog: { eventType: 'EXECUTION_END', status: 1 } }] });
  assert.equal((await m.pedir('make', { tool: 'executions_get', input: { scenarioId: 9918565, executionId: ex } }))[1].payload.status, 1);
  m = montar({ ['/executions/' + ex]: [401, { message: 'no' }] });
  assert.equal((await m.pedir('make', { tool: 'executions_get', input: { scenarioId: 9918565, executionId: ex } }))[0], 502);
  assert.equal((await m.pedir('make', { tool: 'executions_get', input: { scenarioId: 9918565, executionId: '../x' } }))[0], 400);
});

test('marcas de llamado: guardar, mezclar, quitar y limpiar lo antiguo', async () => {
  const { pedir, blobs } = montar();
  assert.deepEqual((await pedir('datos', { op: 'todo' }))[1], { datos: { llamados: {}, listas: {} } });
  await pedir('datos', { op: 'set', col: 'llamados', id: '2026-10-06', body: { e: { '0000000000000001': 111, 'no-vale': 5 }, otra: 1 } });
  const [, j] = await pedir('datos', { op: 'merge', col: 'llamados', id: '2026-10-06', body: { e: { '0000000000000002': 222, '0000000000000001': 0 } } });
  assert.deepEqual(j.datos.llamados, { '2026-10-06': { e: { '0000000000000001': 0, '0000000000000002': 222 } } });
  await pedir('datos', { op: 'merge', col: 'listas', id: '2026-10-06', body: { e: { '0000000000000002': { t: 5, es: 'EN ARRASTRE', mas: 'x' } } } });
  await pedir('datos', { op: 'set', col: 'listas', id: '2026-01-01', body: { e: { '0000000000000002': { t: 1, es: 'x' } } } });
  const [, k] = await pedir('datos', { op: 'todo' });
  assert.deepEqual(k.datos.listas, { '2026-10-06': { e: { '0000000000000002': { t: 5, es: 'EN ARRASTRE' } } } });
  assert.equal((await pedir('datos', { op: 'set', col: 'otra', id: '2026-10-06', body: {} }))[0], 400);
  assert.equal((await pedir('datos', { op: 'set', col: 'llamados', id: '../x', body: {} }))[0], 400);
  const [, b] = await pedir('datos', { op: 'borrar', col: 'llamados', id: '2026-10-06' });
  assert.deepEqual(b.datos.llamados, {}); assert.equal(blobs.size, 2);
});

test('avisa si falta configuración', async () => {
  const m = montar(); delete m.env.MAKE_API_TOKEN;
  const [st, j] = await m.pedir('make', { tool: 'scenarios_run', input: { scenarioId: 9918565 } });
  assert.equal(st, 500); assert.equal(j.code, 'config');
  delete m.env.APP_PASSWORD; assert.equal((await m.pedir('sesion', {}))[0], 500);
});
