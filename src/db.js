const DB_NAME = 'jejak-cerita';
const DB_VERSION = 1;

let databasePromise;

function openDatabase() {
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('Browser ini tidak mendukung penyimpanan offline.'));
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('stories')) {
          db.createObjectStore('stories', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('saved')) {
          db.createObjectStore('saved', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('pending')) {
          db.createObjectStore('pending', { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Database tidak dapat dibuka.'));
      request.onblocked = () => reject(new Error('Tutup tab Jejak lain untuk memperbarui database.'));
    });
  }

  return databasePromise;
}

async function requestStore(storeName, mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Operasi penyimpanan gagal.'));
    transaction.onabort = () => reject(transaction.error || new Error('Transaksi penyimpanan dibatalkan.'));
  });
}

export const putStory = (story) => requestStore('stories', 'readwrite', (store) => store.put(story));
export const getStory = (id) => requestStore('stories', 'readonly', (store) => store.get(id));
export const getAllStories = () => requestStore('stories', 'readonly', (store) => store.getAll());
export const removeStory = (id) => requestStore('stories', 'readwrite', (store) => store.delete(id));
export const saveStory = (story) => requestStore('saved', 'readwrite', (store) => store.put({ id: story.id }));
export const getSavedIds = () => requestStore('saved', 'readonly', (store) => store.getAll());
export const removeSavedStory = (id) => requestStore('saved', 'readwrite', (store) => store.delete(id));
export const putPendingStory = (story) => requestStore('pending', 'readwrite', (store) => store.put(story));
export const getPendingStories = () => requestStore('pending', 'readonly', (store) => store.getAll());
export const removePendingStory = (id) => requestStore('pending', 'readwrite', (store) => store.delete(id));
