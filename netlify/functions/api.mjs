// Función de Netlify: atiende /api/* con la lógica de lib/core.mjs.
import { getStore } from '@netlify/blobs';
import { crearApi } from '../../lib/core.mjs';

const api = crearApi({
  env: process.env,
  fetch: (...a) => fetch(...a),
  store: () => getStore({ name: 'control-entregas', consistency: 'strong' }),
});

export default req => api(req);
export const config = { path: '/api/*' };
