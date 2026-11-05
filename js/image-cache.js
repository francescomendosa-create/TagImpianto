/**
 * Cache locale delle PNG mappa in IndexedDB (Blob).
 * Dopo il primo download su un dispositivo, i cambi pagina usano i file locali.
 * Se l’immagine sul sito cambia (stesso path), va invalidata con clear / nuovo ?v=.
 */

const DB_NAME = "tag-impianto";
const DB_VER = 2;
const STORE = "images";

/** @type {Promise<IDBDatabase>|null} */
let dbp = null;
/** @type {Map<string, string>} url remota -> blob: URL */
const blobUrls = new Map();

function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("maps")) {
        db.createObjectStore("maps", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "url" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function absUrl(src) {
  return new URL(src, location.href).href;
}

/** Path senza query, per cancellare anche chiavi vecchie. */
function urlStem(src) {
  try {
    const u = new URL(src, location.href);
    u.search = "";
    u.hash = "";
    return u.href;
  } catch (_) {
    return String(src || "").split("?")[0];
  }
}

async function getRecord(url) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(url);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function putRecord(url, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      url,
      blob,
      size: blob.size,
      type: blob.type || "image/png",
      savedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function revokeBlob(key) {
  const u = blobUrls.get(key);
  if (u) {
    try {
      URL.revokeObjectURL(u);
    } catch (_) {
      /* ignore */
    }
    blobUrls.delete(key);
  }
}

/** Cancella una mappa (tutte le varianti ?v= dello stesso file). */
export async function deleteLocalImage(src) {
  if (!src) return;
  const stem = urlStem(src);
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      for (const key of req.result || []) {
        if (String(key) === stem || String(key).startsWith(stem + "?") || String(key) === absUrl(src)) {
          store.delete(key);
          revokeBlob(String(key));
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Svuota tutta la cache immagini locale (IndexedDB + blob URL). */
export async function clearAllLocalImages() {
  for (const key of [...blobUrls.keys()]) revokeBlob(key);
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function hasLocalImage(src) {
  const rec = await getRecord(absUrl(src));
  return !!(rec && rec.blob);
}

/** Scarica (se serve) e restituisce un URL utilizzabile in <img> (blob: o remoto). */
export async function resolveLocalImageUrl(src) {
  if (!src) throw new Error("URL immagine mancante");
  const key = absUrl(src);

  if (blobUrls.has(key)) return blobUrls.get(key);

  const existing = await getRecord(key);
  if (existing?.blob) {
    const u = URL.createObjectURL(existing.blob);
    blobUrls.set(key, u);
    return u;
  }

  // Sempre rete fresca: le PNG sul sito possono cambiare a path uguale
  const res = await fetch(src, { cache: "no-store" });
  if (!res.ok) throw new Error(`Download mappa fallito (${res.status})`);
  const blob = await res.blob();
  try {
    await putRecord(key, blob);
  } catch (err) {
    console.warn("Quota IndexedDB immagini:", err);
  }
  const u = URL.createObjectURL(blob);
  blobUrls.set(key, u);
  return u;
}

/**
 * Scarica in locale tutte le mappe (riscarica se manca la chiave versione).
 * @param {{ image?: string, name?: string, id?: string }[]} maps
 * @param {(done: number, total: number, name: string) => void} [onProgress]
 */
export async function warmAllMapImages(maps, onProgress) {
  const list = (maps || []).filter((m) => m?.image);
  const total = list.length;
  let done = 0;
  for (const m of list) {
    const name = m.name || m.id || "";
    try {
      const key = absUrl(m.image);
      const have = await getRecord(key);
      if (!have?.blob) {
        const res = await fetch(m.image, { cache: "no-store" });
        if (res.ok) {
          const blob = await res.blob();
          try {
            await putRecord(key, blob);
          } catch (err) {
            console.warn("Quota IndexedDB:", err);
          }
        }
      }
    } catch (err) {
      console.warn("warm map fail", m.id, err);
    }
    done += 1;
    if (onProgress) onProgress(done, total, name);
  }
  return { done, total };
}

export async function countLocalImages() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}
