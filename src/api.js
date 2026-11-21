const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'https://story-api.dicoding.dev/v1').replace(/\/$/, '');

function authHeaders(token = localStorage.getItem('jejak-token')) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch (error) {
    throw new TypeError('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.', { cause: error });
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) {
    throw new Error(result.message || `Permintaan gagal (${response.status}).`);
  }
  return result;
}

export function getStories() {
  return request('/stories?location=1', { headers: authHeaders() });
}

export function getStory(id) {
  return request(`/stories/${encodeURIComponent(id)}`, { headers: authHeaders() });
}

export function login(credentials) {
  return request('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
}

export function register(details) {
  return request('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(details),
  });
}

export function createStory({ description, photo, lat, lon, guest = false }) {
  const body = new FormData();
  body.append('description', description);
  body.append('photo', photo);
  if (Number.isFinite(lat)) body.append('lat', String(lat));
  if (Number.isFinite(lon)) body.append('lon', String(lon));
  return request(guest ? '/stories/guest' : '/stories', {
    method: 'POST',
    headers: authHeaders(),
    body,
  });
}

export function getVapidKey() {
  return request('/notifications/vapid-public-key', { headers: authHeaders() }).catch(() =>
    ({
      publicKey: 'BCCs2eonMI-6H2ctvFaWg-UYdDv387Vno_bzUzALpB442r2lCnsHmtrx8biyPi_E-1fSGABK_Qs_GlvPoJJqxbk',
    }),
  );
}

export function subscribePush(subscription) {
  return request('/notifications/subscribe', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  });
}

export function unsubscribePush(endpoint) {
  return request('/notifications/subscribe', {
    method: 'DELETE',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
}

export function isNetworkError(error) {
  return error instanceof TypeError || !navigator.onLine;
}
