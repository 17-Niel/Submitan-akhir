import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerUrl from 'leaflet/dist/images/marker-icon.png';
import markerRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';
import {
  createStory,
  getStories,
  getStory,
  getVapidKey,
  isNetworkError,
  login,
  register,
  subscribePush,
  unsubscribePush,
} from '../api.js';
import {
  getAllStories,
  getPendingStories,
  getSavedIds,
  getStory as getCachedStory,
  putPendingStory,
  putStory,
  removePendingStory,
  removeStory,
  removeSavedStory,
  saveStory,
} from '../db.js';
import '../style.css';
import { runViewTransition } from '../utils/view-transition.js';

const app = document.querySelector('#app');
const markerIcon = L.icon({
  iconUrl: markerUrl,
  iconRetinaUrl: markerRetinaUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

let mapInstance;
let installPrompt;
let toastTimer;
let authMode = 'login';
let pendingSync = false;
const photoUrls = new Map();

const safe = (value = '') =>
  String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);

const dateLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Baru saja'
    : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(date);
};

const locationLabel = (story) =>
  Number.isFinite(story.lat) && Number.isFinite(story.lon)
    ? `${Number(story.lat).toFixed(4)}, ${Number(story.lon).toFixed(4)}`
    : 'Lokasi tidak ditambahkan';

function storyImage(story) {
  if (story.photo instanceof Blob) {
    if (!photoUrls.has(story.id)) photoUrls.set(story.id, URL.createObjectURL(story.photo));
    return photoUrls.get(story.id);
  }
  return story.photoUrl || '';
}

function getRoute() {
  const path = location.hash.replace(/^#\/?/, '') || 'home';
  const [page, ...rest] = path.split('/');
  return { page, id: decodeURIComponent(rest.join('/')) };
}

function toast(message, type = 'info') {
  const region = document.querySelector('#toast-region');
  if (!region) return;
  region.innerHTML = `<div class="toast toast--${type}" role="status">${safe(message)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    region.innerHTML = '';
  }, 4200);
}

function stopMap() {
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = undefined;
  }
}

function shell(content, active = 'home') {
  const user = JSON.parse(localStorage.getItem('jejak-user') || 'null');
  return `
    <header class="site-header">
      <a class="brand" href="#/home" aria-label="Jejak, beranda">
        <span class="brand-mark" aria-hidden="true">J</span>
        <span>jejak<span class="brand-dot">.</span></span>
      </a>
      <nav class="main-nav" aria-label="Navigasi utama">
        <a class="${active === 'home' ? 'is-active' : ''}" href="#/home">Jelajahi</a>
        <a class="${active === 'saved' ? 'is-active' : ''}" href="#/saved">Tersimpan</a>
        <a class="${active === 'create' ? 'is-active' : ''}" href="#/create">Bagikan cerita</a>
      </nav>
      <div class="header-actions">
        <button class="button button--quiet install-button" type="button" ${installPrompt ? '' : 'hidden'}>↓ <span>Pasang aplikasi</span></button>
        <button class="button button--quiet push-toggle" type="button" aria-pressed="false" title="Aktifkan notifikasi">♧ <span>Notifikasi</span></button>
        ${
          user
            ? `<button class="user-chip" type="button" data-action="logout" aria-label="Keluar, ${safe(user.name)}"><span class="avatar">${safe(user.name.slice(0, 1).toUpperCase())}</span><span class="user-name">${safe(user.name)}</span><span aria-hidden="true">↗</span></button>`
            : '<a class="button button--dark header-login" href="#/account">Masuk</a>'
        }
        <button class="menu-toggle" type="button" aria-label="Buka navigasi" aria-expanded="false">☰</button>
      </div>
    </header>
    <main id="main-content" tabindex="-1">${content}</main>
    <footer class="site-footer">
      <a class="brand brand--footer" href="#/home"><span class="brand-mark" aria-hidden="true">J</span><span>jejak<span class="brand-dot">.</span></span></a>
      <p>Setiap perjalanan punya cerita. <span>© ${new Date().getFullYear()} Jejak</span></p>
    </footer>
    <div id="toast-region" class="toast-region" aria-live="polite" aria-atomic="true"></div>
  `;
}

function storyCard(story, isSaved = false) {
  const pending = story.pending;
  const imageUrl = storyImage(story);
  const image = imageUrl
    ? `<img src="${safe(imageUrl)}" alt="" loading="lazy" />`
    : '<div class="story-image-placeholder" aria-hidden="true">✳</div>';
  return `
    <article class="story-card">
      <a class="story-photo" href="#/story/${encodeURIComponent(story.id)}" aria-label="Baca cerita ${safe(story.name || 'pengguna')}">
        ${image}
        ${pending ? '<span class="pending-badge">Menunggu sinkronisasi</span>' : ''}
      </a>
      <div class="story-card-content">
        <div class="story-meta"><span>${safe(story.name || 'Penjelajah')}</span><span>${safe(dateLabel(story.createdAt))}</span></div>
        <p>${safe(story.description || '')}</p>
        <div class="story-card-bottom">
          <span class="location-tag" title="${safe(locationLabel(story))}">⌖ ${safe(locationLabel(story))}</span>
          ${
            isSaved
                ? `<button class="icon-button" type="button" data-action="${pending ? 'discard' : 'unsave'}" data-id="${safe(story.id)}" aria-label="${pending ? 'Hapus draft' : 'Hapus'} ${safe(story.name || 'cerita')} dari tersimpan">×</button>`
              : `<button class="icon-button" type="button" data-action="save" data-id="${safe(story.id)}" aria-label="Simpan cerita ${safe(story.name || '')}">♡</button>`
          }
        </div>
      </div>
    </article>
  `;
}

function homeView() {
  return shell(`
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow"><span class="eyebrow-line"></span> CERITA YANG MEMBAWA KITA LEBIH DEKAT</p>
        <h1>Temukan jejak<br />di setiap <em>perjalanan.</em></h1>
        <p class="hero-description">Potongan cerita dari tempat-tempat yang pernah disinggahi. Mungkin, perjalanan berikutnya dimulai dari sini.</p>
        <div class="hero-actions"><a class="button button--lime" href="#/create">Bagikan ceritamu <span aria-hidden="true">↗</span></a><a class="text-link" href="#stories">Lihat cerita <span aria-hidden="true">↓</span></a></div>
        <div class="hero-note"><span class="note-avatars" aria-hidden="true"><i>R</i><i>A</i><i>M</i></span><span>Perjalanan kecil, cerita yang berarti.</span></div>
      </div>
      <div class="hero-art" aria-label="Ilustrasi lanskap perjalanan">
        <div class="art-sun"></div><div class="art-ridge art-ridge--back"></div><div class="art-ridge art-ridge--front"></div>
        <div class="art-stamp"><span>GO<br />SLOW</span><small>and see more</small></div>
        <span class="art-caption">— EAST JAVA, INDONESIA</span>
        <span class="art-sparkle art-sparkle--one">✳</span><span class="art-sparkle art-sparkle--two">✳</span>
      </div>
    </section>
    <section class="explore-section section-wrap" id="stories">
      <div class="section-heading">
        <div><p class="eyebrow">CATATAN DARI BERBAGAI PENJURU</p><h2>Cerita yang <em>baru ditemukan.</em></h2></div>
        <label class="search-box"><span aria-hidden="true">⌕</span><span class="visually-hidden">Cari cerita</span><input id="story-search" type="search" placeholder="Cari cerita atau nama..." autocomplete="off" /></label>
      </div>
      <div class="map-heading"><span class="map-heading-icon">⌖</span><div><h3>Jejak di peta</h3><p>Lokasi cerita dari komunitas</p></div><span class="map-hint">Pilih penanda untuk membuka cerita</span></div>
      <div id="stories-map" class="stories-map" role="region" aria-label="Peta lokasi cerita"></div>
      <div class="list-heading"><h3>Terbaru dibagikan</h3><span id="story-count" class="muted-text"></span></div>
      <div id="stories-status" class="inline-status" role="status">Memuat cerita...</div>
      <div id="stories-grid" class="stories-grid"></div>
    </section>
  `);
}

function savedView() {
  return shell(`
    <section class="page-intro section-wrap">
      <p class="eyebrow">KOLEKSI PRIBADIMU</p><h1>Cerita yang <em>ingin diingat.</em></h1>
      <p>Simpan cerita favorit untuk dibaca lagi, bahkan saat sedang offline.</p>
      <label class="search-box search-box--saved"><span aria-hidden="true">⌕</span><span class="visually-hidden">Cari cerita tersimpan</span><input id="saved-search" type="search" placeholder="Cari koleksimu..." autocomplete="off" /></label>
    </section>
    <section class="section-wrap saved-section"><div class="list-heading"><h2>Koleksi tersimpan</h2><span id="saved-count" class="muted-text"></span></div>
      <div id="saved-status" class="inline-status" role="status">Memuat koleksi...</div><div id="saved-grid" class="stories-grid"></div>
    </section>
  `, 'saved');
}

function createView() {
  return shell(`
    <section class="create-layout section-wrap">
      <div class="create-intro"><p class="eyebrow">CERITAMU PANTAS DIBAGIKAN</p><h1>Satu momen,<br /><em>selamanya.</em></h1><p>Tambahkan foto, ceritakan momenmu, lalu tandai tempatnya. Cerita bisa dibuat offline dan akan terkirim saat koneksi kembali.</p>
        <div class="offline-note"><span>◉</span><div><strong>Siap untuk offline</strong><small>Draft akan disinkronkan otomatis saat online.</small></div></div>
      </div>
      <form id="story-form" class="story-form">
        <label class="field-label" for="story-description">Ceritakan momenmu <span aria-hidden="true">*</span></label>
        <textarea id="story-description" name="description" rows="5" maxlength="1000" placeholder="Apa yang membuat tempat ini terasa istimewa?" required></textarea>
        <div class="field-hint"><span>Bagikan cerita yang hangat dan bermakna.</span><span id="char-count">0/1000</span></div>
        <label class="field-label photo-label" for="story-photo">Foto cerita <span aria-hidden="true">*</span></label>
        <label class="upload-area" for="story-photo"><span class="upload-symbol">↑</span><strong>Pilih foto untuk ceritamu</strong><span>JPG, PNG, atau WEBP · Maksimal 1 MB</span><span id="photo-name" class="photo-name"></span></label>
        <input id="story-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required class="visually-hidden" />
        <div class="location-label"><div><label class="field-label" for="location-search">Lokasi cerita <span class="optional">(opsional)</span></label><p>Cari tempat atau klik peta untuk memilih titik.</p></div><button class="button button--quiet location-button" type="button" data-action="locate">◎ Lokasiku</button></div>
        <input id="location-search" class="location-search" type="search" placeholder="Cari nama tempat atau alamat..." aria-label="Cari lokasi cerita" />
        <div id="location-results" class="location-results" role="listbox" aria-label="Hasil pencarian lokasi"></div>
        <div id="picker-map" class="picker-map" role="region" aria-label="Peta, klik untuk menentukan lokasi"></div>
        <p id="selected-location" class="selected-location">Belum ada lokasi yang dipilih.</p>
        <input type="hidden" name="lat" /><input type="hidden" name="lon" />
        <button class="button button--dark submit-story" type="submit"><span>Bagikan cerita</span><span aria-hidden="true">↗</span></button>
        <p class="form-footnote">Dengan membagikan, ceritamu dapat dilihat oleh komunitas Jejak.</p>
      </form>
    </section>
  `, 'create');
}

function accountView() {
  const registering = authMode === 'register';
  return shell(`
    <section class="account-section section-wrap">
      <div class="account-art"><p class="eyebrow">SELAMAT DATANG DI JEJAK</p><h1>Perjalanan lebih seru saat <em>dibagikan.</em></h1><p>Masuk untuk mengikuti cerita baru dan mendapatkan notifikasi saat ada perjalanan yang dibagikan.</p><span class="account-art-mark">J.</span></div>
      <form id="account-form" class="account-form">
        <p class="eyebrow">${registering ? 'MULAI PERJALANANMU' : 'SENANG BERTEMU KEMBALI'}</p><h2>${registering ? 'Buat akun baru' : 'Masuk ke Jejak'}</h2><p class="account-subtitle">${registering ? 'Bergabung dan mulai berbagi cerita.' : 'Masuk untuk menyimpan dan membagikan cerita.'}</p>
        ${registering ? '<label class="field-label" for="account-name">Nama</label><input id="account-name" name="name" autocomplete="name" required minlength="2" placeholder="Namamu" />' : ''}
        <label class="field-label" for="account-email">Email</label><input id="account-email" name="email" type="email" autocomplete="email" required placeholder="nama@email.com" />
        <label class="field-label" for="account-password">Password</label><input id="account-password" name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" required minlength="8" placeholder="Minimal 8 karakter" />
        <button class="button button--dark account-submit" type="submit">${registering ? 'Daftar' : 'Masuk'} <span aria-hidden="true">↗</span></button>
        <p class="account-switch">${registering ? 'Sudah punya akun?' : 'Belum punya akun?'} <button type="button" class="text-button" data-action="toggle-auth">${registering ? 'Masuk' : 'Daftar sekarang'}</button></p>
        <a class="guest-link" href="#/home">Lanjut jelajahi tanpa akun →</a>
      </form>
    </section>
  `, 'account');
}

function detailLoadingView() {
  return shell('<section class="detail-section section-wrap"><p class="eyebrow">CERITA PERJALANAN</p><div class="inline-status">Memuat cerita...</div></section>');
}

function render() {
  runViewTransition(() => {
    stopMap();
    const { page } = getRoute();
    const content = page === 'saved' ? savedView()
      : page === 'create' ? createView()
        : page === 'account' ? accountView()
          : page === 'story' ? detailLoadingView()
            : homeView();
    app.innerHTML = content;
    document.querySelector('.install-button').hidden = !installPrompt;
    syncPushButton();
    bindMenu();
    if (page === 'home') loadHome();
    if (page === 'saved') loadSaved();
    if (page === 'create') setupCreateForm();
    if (page === 'story') loadDetail(getRoute().id);
    if (page === 'account') bindAccountForm();
    document.querySelector('#main-content').focus({ preventScroll: true });
  });
}

function bindMenu() {
  const button = document.querySelector('.menu-toggle');
  button?.addEventListener('click', () => {
    const nav = document.querySelector('.main-nav');
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    nav.classList.toggle('is-open', !expanded);
  });
}

async function loadHome() {
  const status = document.querySelector('#stories-status');
  let stories = [];
  try {
    if (!navigator.onLine) throw new TypeError('offline');
    const result = await getStories();
    stories = result.listStory || [];
    await Promise.all(stories.map((story) => putStory(story)));
    status.textContent = stories.length ? '' : 'Belum ada cerita. Jadilah yang pertama membagikan!';
  } catch (error) {
    const cached = await getAllStories();
    stories = cached.filter((story) => !story.pending);
    status.textContent = stories.length
      ? 'Sedang offline — menampilkan cerita yang pernah dimuat.'
      : (isNetworkError(error)
        ? 'Koneksi tidak tersedia dan belum ada cerita tersimpan.'
        : error.message === 'Missing authentication'
          ? 'Masuk atau buat akun Story API untuk menjelajahi cerita komunitas.'
          : error.message);
    status.classList.toggle('status-error', !isNetworkError(error));
  }
  if (!document.querySelector('#stories-grid')) return;
  const grid = document.querySelector('#stories-grid');
  const renderStories = (query = '') => {
    const filtered = stories.filter((story) => `${story.description} ${story.name}`.toLowerCase().includes(query.toLowerCase()));
    grid.innerHTML = filtered.map((story) => storyCard(story)).join('');
    document.querySelector('#story-count').textContent = `${filtered.length} cerita`;
  };
  renderStories();
  drawStoryMap(stories);
  document.querySelector('#story-search').addEventListener('input', (event) => renderStories(event.target.value.trim()));
}

function drawStoryMap(stories) {
  const target = document.querySelector('#stories-map');
  if (!target) return;
  const located = stories.filter((story) => Number.isFinite(story.lat) && Number.isFinite(story.lon));
  mapInstance = L.map(target, { scrollWheelZoom: false, zoomControl: true }).setView([-2.5, 118], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(mapInstance);
  located.forEach((story) => {
    const popup = `<a class="map-popup" href="#/story/${encodeURIComponent(story.id)}"><strong>${safe(story.name || 'Penjelajah')}</strong><br>${safe((story.description || '').slice(0, 72))}...</a>`;
    L.marker([story.lat, story.lon], { icon: markerIcon }).addTo(mapInstance).bindPopup(popup);
  });
  if (located.length > 1) {
    mapInstance.fitBounds(L.latLngBounds(located.map((story) => [story.lat, story.lon])), { padding: [24, 24], maxZoom: 10 });
  } else if (located.length === 1) {
    mapInstance.setView([located[0].lat, located[0].lon], 8);
  }
  setTimeout(() => mapInstance?.invalidateSize(), 100);
}

async function loadSaved() {
  const status = document.querySelector('#saved-status');
  const grid = document.querySelector('#saved-grid');
  const [ids, allStories, pending] = await Promise.all([getSavedIds(), getAllStories(), getPendingStories()]);
  const savedSet = new Set(ids.map((item) => item.id));
  const stories = allStories.filter((story) => savedSet.has(story.id)).map((story) => ({
    ...story,
    pending: pending.some((item) => item.id === story.id),
  }));
  const renderStories = (query = '') => {
    const filtered = stories.filter((story) => `${story.description} ${story.name}`.toLowerCase().includes(query.toLowerCase()));
    grid.innerHTML = filtered.map((story) => storyCard(story, true)).join('');
    document.querySelector('#saved-count').textContent = `${filtered.length} cerita`;
    status.textContent = filtered.length ? '' : (stories.length ? 'Tidak ada cerita yang cocok dengan pencarian.' : 'Belum ada cerita tersimpan. Jelajahi cerita dan tekan ♡ untuk menyimpan.');
  };
  renderStories();
  document.querySelector('#saved-search').addEventListener('input', (event) => renderStories(event.target.value.trim()));
}

async function loadDetail(id) {
  let story;
  try {
    if (!navigator.onLine) throw new TypeError('offline');
    const result = await getStory(id);
    story = result.story;
    await putStory(story);
  } catch (error) {
    story = await getCachedStory(id);
    if (!story) {
      app.innerHTML = shell(`<section class="detail-section section-wrap"><p class="eyebrow">CERITA PERJALANAN</p><h1>Cerita belum <em>tersedia.</em></h1><p>${safe(isNetworkError(error) ? 'Cerita ini belum tersedia secara offline.' : error.message)}</p><a class="button button--dark" href="#/home">Kembali menjelajah</a></section>`);
      return;
    }
  }
  const coords = Number.isFinite(story.lat) && Number.isFinite(story.lon);
  app.innerHTML = shell(`
    <article class="detail-section section-wrap">
      <a class="back-link" href="#/home">← Kembali ke cerita</a>
      <div class="detail-meta"><span class="eyebrow">CERITA PERJALANAN</span><span>${safe(dateLabel(story.createdAt))}</span></div>
      <h1>${safe(story.name || 'Sebuah cerita')} <em>di perjalanan.</em></h1>
      <p class="detail-byline">Dibagikan oleh <strong>${safe(story.name || 'Penjelajah')}</strong>${story.pending ? ' · Menunggu sinkronisasi' : ''}</p>
      ${storyImage(story) ? `<img class="detail-image" src="${safe(storyImage(story))}" alt="Foto perjalanan yang dibagikan oleh ${safe(story.name || 'penjelajah')}" />` : ''}
      <div class="detail-body"><p>${safe(story.description || '')}</p><div class="detail-location"><span>⌖</span><div><strong>Lokasi cerita</strong><p>${safe(locationLabel(story))}</p></div></div></div>
      ${coords ? '<div id="detail-map" class="detail-map" role="region" aria-label="Peta lokasi cerita"></div>' : ''}
      <button class="button button--lime" type="button" data-action="save" data-id="${safe(story.id)}">♡ Simpan cerita</button>
    </article>
  `);
  document.querySelector('.install-button').hidden = !installPrompt;
  bindMenu();
  if (coords) {
    const detailMap = L.map('detail-map', { scrollWheelZoom: false }).setView([story.lat, story.lon], 12);
    mapInstance = detailMap;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(detailMap);
    L.marker([story.lat, story.lon], { icon: markerIcon }).addTo(detailMap);
  }
}

function setupCreateForm() {
  const form = document.querySelector('#story-form');
  const photoInput = document.querySelector('#story-photo');
  let selected = null;
  photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    document.querySelector('#photo-name').textContent = file ? file.name : '';
  });
  form.description.addEventListener('input', () => {
    document.querySelector('#char-count').textContent = `${form.description.value.length}/1000`;
  });

  mapInstance = L.map('picker-map').setView([-2.5, 118], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(mapInstance);
  mapInstance.on('click', (event) => chooseLocation(event.latlng.lat, event.latlng.lng, 'Lokasi pilihan di peta'));
  setTimeout(() => mapInstance?.invalidateSize(), 100);

  function chooseLocation(lat, lon, label) {
    selected = { lat, lon };
    form.lat.value = String(lat);
    form.lon.value = String(lon);
    document.querySelector('#selected-location').textContent = `${label} · ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    if (mapInstance) {
      mapInstance.eachLayer((layer) => {
        if (layer instanceof L.Marker) mapInstance.removeLayer(layer);
      });
      L.marker([lat, lon], { icon: markerIcon }).addTo(mapInstance);
      mapInstance.setView([lat, lon], 12);
    }
  }

  document.querySelector('[data-action="locate"]').addEventListener('click', () => {
    if (!navigator.geolocation) {
      toast('Browser tidak mendukung lokasi perangkat.', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => chooseLocation(coords.latitude, coords.longitude, 'Lokasi perangkat'),
      () => toast('Lokasi tidak dapat diakses. Periksa izin lokasi browser.', 'error'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  let searchTimer;
  const search = document.querySelector('#location-search');
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = search.value.trim();
    if (query.length < 3) {
      document.querySelector('#location-results').innerHTML = '';
      return;
    }
    searchTimer = setTimeout(async () => {
      const results = document.querySelector('#location-results');
      if (!navigator.onLine) {
        results.innerHTML = '<p class="location-result-message">Pencarian tempat memerlukan koneksi internet. Kamu tetap bisa memilih titik di peta.</p>';
        return;
      }
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`, {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error('Pencarian lokasi gagal.');
        const places = await response.json();
        results.innerHTML = places.length
          ? places.map((place, index) => `<button type="button" role="option" class="location-result" data-place-index="${index}">${safe(place.display_name)}</button>`).join('')
          : '<p class="location-result-message">Tempat tidak ditemukan.</p>';
        results.querySelectorAll('[data-place-index]').forEach((button) => {
          button.addEventListener('click', () => {
            const place = places[Number(button.dataset.placeIndex)];
            chooseLocation(Number(place.lat), Number(place.lon), place.display_name);
            results.innerHTML = '';
            search.value = place.display_name;
          });
        });
      } catch {
        results.innerHTML = '<p class="location-result-message">Pencarian lokasi gagal. Pilih titik langsung di peta.</p>';
      }
    }, 450);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = photoInput.files[0];
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast('Pilih foto berformat JPG, PNG, atau WEBP.', 'error');
      return;
    }
    if (file.size > 1024 * 1024) {
      toast('Ukuran foto maksimal 1 MB.', 'error');
      return;
    }
    const description = form.description.value.trim();
    if (!description) {
      toast('Cerita tidak boleh kosong.', 'error');
      return;
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.innerHTML = '<span>Mengirim cerita...</span>';
    const token = localStorage.getItem('jejak-token');
    try {
      if (!navigator.onLine) throw new TypeError('offline');
      const result = await createStory({
        description,
        photo: file,
        lat: selected?.lat,
        lon: selected?.lon,
        guest: !token,
      });
      toast(result.message || 'Ceritamu berhasil dibagikan!', 'success');
      setTimeout(() => { location.hash = `#/story/${result.story?.id || ''}`; }, 500);
    } catch (error) {
      if (!isNetworkError(error)) {
        toast(error.message || 'Cerita gagal dibagikan.', 'error');
        button.disabled = false;
        button.innerHTML = '<span>Bagikan cerita</span><span aria-hidden="true">↗</span>';
        return;
      }
      const id = `offline-${crypto.randomUUID()}`;
      const user = JSON.parse(localStorage.getItem('jejak-user') || 'null');
      const offlineStory = {
        id,
        name: user?.name || 'Kamu',
        description,
        createdAt: new Date().toISOString(),
        lat: selected?.lat,
        lon: selected?.lon,
        pending: true,
        photo: file,
      };
      await putStory(offlineStory);
      await saveStory(offlineStory);
      await putPendingStory(offlineStory);
      toast('Draft tersimpan. Cerita akan dikirim saat kamu kembali online.', 'success');
      setTimeout(() => { location.hash = '#/saved'; }, 700);
    }
  });
}

function bindAccountForm() {
  document.querySelector('#account-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const credentials = Object.fromEntries(new FormData(form));
      const result = authMode === 'register' ? await register(credentials) : await login(credentials);
      if (authMode === 'register') {
        authMode = 'login';
        toast(result.message || 'Akun berhasil dibuat. Silakan masuk.', 'success');
        render();
        return;
      }
      const { token, userId, name } = result.loginResult;
      localStorage.setItem('jejak-token', token);
      localStorage.setItem('jejak-user', JSON.stringify({ userId, name }));
      toast(`Selamat datang, ${name}!`, 'success');
      location.hash = '#/home';
      render();
      syncPendingStories();
    } catch (error) {
      toast(error.message || 'Akun tidak dapat diproses.', 'error');
    } finally {
      button.disabled = false;
    }
  });
}

async function syncPendingStories() {
  if (!navigator.onLine || pendingSync) return;
  pendingSync = true;
  let pendingStories = [];
  let syncedCount = 0;
  try {
    pendingStories = await getPendingStories();
    for (const story of pendingStories) {
      try {
        const result = await createStory({
          description: story.description,
          photo: story.photo,
          lat: story.lat,
          lon: story.lon,
          guest: !localStorage.getItem('jejak-token'),
        });
        const published = result.story
          ? { ...result.story, pending: false }
          : { ...story, pending: false };
        await putStory(published);
        await saveStory(published);
        await removePendingStory(story.id);
        if (published.id !== story.id) {
          await removeSavedStory(story.id);
          await removeStory(story.id);
        }
        syncedCount += 1;
        const imageUrl = photoUrls.get(story.id);
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        photoUrls.delete(story.id);
      } catch (error) {
        if (isNetworkError(error)) break;
        console.error('Gagal menyinkronkan cerita offline:', error);
        toast(`Draft "${story.description.slice(0, 32)}..." belum tersinkron: ${error.message}`, 'error');
      }
    }
  } finally {
    pendingSync = false;
  }
  if (syncedCount) {
    toast(`${syncedCount} cerita offline berhasil disinkronkan.`, 'success');
    if (getRoute().page === 'saved') loadSaved();
  }
}

function decodeVapidKey(key) {
  const padding = '='.repeat((4 - (key.length % 4)) % 4);
  const base64 = (key + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function syncPushButton() {
  const button = document.querySelector('.push-toggle');
  if (!button || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    button.setAttribute('aria-pressed', String(Boolean(subscription)));
    button.title = subscription ? 'Nonaktifkan notifikasi' : 'Aktifkan notifikasi';
    button.querySelector('span').textContent = subscription ? 'Notifikasi aktif' : 'Notifikasi';
  } catch {
    button.disabled = true;
    button.title = 'Notifikasi tidak tersedia di browser ini';
  }
}

async function togglePush() {
  if (!localStorage.getItem('jejak-token')) {
    toast('Masuk terlebih dahulu untuk mengatur notifikasi.', 'error');
    location.hash = '#/account';
    return;
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    toast('Browser ini belum mendukung push notification.', 'error');
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await unsubscribePush(existing.endpoint);
      await existing.unsubscribe();
      toast('Notifikasi berhasil dinonaktifkan.', 'success');
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Izin notifikasi belum diberikan.');
      const result = await getVapidKey();
      const publicKey = result?.data?.publicKey || result?.publicKey || result?.vapidPublicKey;
      if (!publicKey) throw new Error('Public VAPID key tidak tersedia dari server.');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(publicKey),
      });
      try {
        await subscribePush(subscription.toJSON());
      } catch (error) {
        await subscription.unsubscribe();
        throw error;
      }
      toast('Notifikasi berhasil diaktifkan.', 'success');
    }
    syncPushButton();
  } catch (error) {
    toast(error.message || 'Pengaturan notifikasi gagal.', 'error');
  }
}

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]');
  if (action) {
    const id = action.dataset.id;
    if (action.dataset.action === 'save' && id) {
      const story = await getCachedStory(id);
      if (story) {
        await saveStory(story);
        toast('Cerita disimpan untuk dibaca offline.', 'success');
      } else {
        toast('Cerita belum tersimpan di perangkat.', 'error');
      }
    }
    if (action.dataset.action === 'unsave' && id) {
      await removeSavedStory(id);
      toast('Cerita dihapus dari koleksi tersimpan.', 'success');
      loadSaved();
    }
    if (action.dataset.action === 'discard' && id) {
      await removePendingStory(id);
      await removeSavedStory(id);
      await removeStory(id);
      const imageUrl = photoUrls.get(id);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      photoUrls.delete(id);
      toast('Draft offline dihapus dari perangkat.', 'success');
      loadSaved();
    }
    if (action.dataset.action === 'logout') {
      localStorage.removeItem('jejak-token');
      localStorage.removeItem('jejak-user');
      toast('Kamu sudah keluar dari akun.', 'success');
      render();
    }
    if (action.dataset.action === 'toggle-auth') {
      authMode = authMode === 'login' ? 'register' : 'login';
      render();
    }
  }
  if (event.target.closest('.push-toggle')) togglePush();
  if (event.target.closest('.install-button') && installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    document.querySelector('.install-button').hidden = true;
  }
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  const button = document.querySelector('.install-button');
  if (button) button.hidden = false;
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('Jejak berhasil dipasang di perangkatmu.', 'success');
});

window.addEventListener('online', () => {
  toast('Koneksi kembali. Menyinkronkan cerita offline...', 'info');
  syncPendingStories();
  if (getRoute().page === 'home') loadHome();
});

window.addEventListener('hashchange', render);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service worker gagal didaftarkan:', error);
      toast('Mode offline belum tersedia karena service worker gagal dimuat.', 'error');
    });
  });
}

render();
syncPendingStories();
