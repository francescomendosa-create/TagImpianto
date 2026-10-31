import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const DB_NAME = "tag-impianto";
const DB_VER = 1;
const STORE = "maps";

let idb;
let firestore = null;
let storage = null;
let cloudReady = false;

function openIdb() {
  if (idb) return idb;
  idb = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idb;
}

async function idbGetAll() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(map) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(map);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function isCloudReady() {
  return cloudReady;
}

export async function initCloud() {
  if (!isFirebaseConfigured()) {
    cloudReady = false;
    return { ok: false, reason: "Firebase non configurato" };
  }
  try {
    const [{ initializeApp }, { getFirestore }, { getStorage }] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"),
      import("https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js"),
    ]);
    const app = initializeApp(firebaseConfig);
    firestore = getFirestore(app);
    storage = getStorage(app);
    cloudReady = true;
    return { ok: true };
  } catch (err) {
    cloudReady = false;
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function loadSeedIfEmpty() {
  const existing = await idbGetAll();
  if (existing.length) return existing;

  const res = await fetch("./data/sediflottatore-b.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Seed mappa non trovato");
  const map = await res.json();
  map.updatedAt = Date.now();
  await idbPut(map);
  return [map];
}

export async function listMaps() {
  const local = await idbGetAll();
  local.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, "it"));
  return local;
}

export async function getMap(id) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMap(map, { sync = true } = {}) {
  map.updatedAt = Date.now();
  await idbPut(map);
  if (sync && cloudReady) {
    try {
      await pushMapToCloud(map);
    } catch (err) {
      console.warn("Sync cloud fallita:", err);
    }
  }
  return map;
}

export async function searchAllTags(query) {
  const q = String(query || "").trim().toUpperCase();
  if (!q) return [];
  const maps = await listMaps();
  const hits = [];
  for (const map of maps) {
    for (const tag of map.tags || []) {
      const label = String(tag.label || tag.id || "").toUpperCase();
      const id = String(tag.id || "").toUpperCase();
      if (label.includes(q) || id.includes(q)) {
        hits.push({ mapId: map.id, mapName: map.name, tag });
      }
    }
  }
  hits.sort((a, b) => {
    const ai = String(a.tag.id).toUpperCase();
    const bi = String(b.tag.id).toUpperCase();
    const aExact = ai === q || String(a.tag.label || "").toUpperCase() === q;
    const bExact = bi === q || String(b.tag.label || "").toUpperCase() === q;
    if (aExact !== bExact) return aExact ? -1 : 1;
    return ai.localeCompare(bi);
  });
  return hits;
}

async function pushMapToCloud(map) {
  const { doc, setDoc, collection, writeBatch } = await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  );
  const meta = {
    id: map.id,
    name: map.name,
    image: map.image,
    width: map.width,
    height: map.height,
    notes: map.notes || "",
    updatedAt: map.updatedAt || Date.now(),
    tagCount: (map.tags || []).length,
  };
  await setDoc(doc(firestore, "tagImpianto_maps", map.id), meta, { merge: true });

  const batch = writeBatch(firestore);
  for (const tag of map.tags || []) {
    const ref = doc(collection(firestore, "tagImpianto_maps", map.id, "tags"), tag.id);
    batch.set(ref, tag, { merge: true });
  }
  await batch.commit();
}

export async function pullMapsFromCloud() {
  if (!cloudReady) return [];
  const { collection, getDocs } = await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  );
  const snap = await getDocs(collection(firestore, "tagImpianto_maps"));
  const maps = [];
  for (const d of snap.docs) {
    const meta = d.data();
    const tagsSnap = await getDocs(collection(firestore, "tagImpianto_maps", d.id, "tags"));
    const tags = tagsSnap.docs.map((t) => t.data());
    const map = { ...meta, id: d.id, tags };
    await idbPut(map);
    maps.push(map);
  }
  return maps;
}

export async function uploadMapImage(mapId, file) {
  if (!cloudReady || !storage) throw new Error("Cloud non pronto");
  const { ref, uploadBytes, getDownloadURL } = await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js"
  );
  const path = `tagImpianto/maps/${mapId}/${file.name || "map.png"}`;
  const r = ref(storage, path);
  await uploadBytes(r, file);
  return getDownloadURL(r);
}
