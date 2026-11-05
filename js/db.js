import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js?v=1.6.2";

const DB_NAME = "tag-impianto";
const DB_VER = 2;
const STORE = "maps";
const STORE_IMAGES = "images";

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
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: "url" });
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

function remapTagsAfterCrop(tags, cropLeft, oldW, newW) {
  return (tags || []).map((t) => {
    const x = Number(t.x) * oldW;
    const w = Number(t.w) * oldW;
    return {
      ...t,
      x: Math.max(0, (x - cropLeft) / newW),
      w: Math.max(0.02, w / newW),
    };
  });
}

async function resolveSeedPaths() {
  try {
    const res = await fetch("./data/manifest.json", { cache: "no-store" });
    if (res.ok) {
      const man = await res.json();
      if (Array.isArray(man.maps) && man.maps.length) return man.maps;
    }
  } catch (_) {
    /* fallback sotto */
  }
  return [
    "./data/sediflottatore-b.json",
    "./data/biologico-mbbr-123.json",
    "./data/ultrafiltrazione-mbr-ad.json",
  ];
}

/** Carica seed mancanti e allinea immagini ritagliate (colonna menu rimossa). */
export async function loadSeedIfEmpty() {
  const existing = await idbGetAll();
  const byId = new Map(existing.map((m) => [m.id, m]));
  const paths = await resolveSeedPaths();

  for (const path of paths) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) continue;
      const seed = await res.json();
      if (!seed?.id) continue;
      const local = byId.get(seed.id);

      if (!local) {
        seed.updatedAt = Date.now();
        await idbPut(seed);
        byId.set(seed.id, seed);
        continue;
      }

      let changed = false;
      const seedRev = Number(seed.seedRev) || 0;
      const localRev = Number(local.seedRev) || 0;
      const seedTagN = (seed.tags || []).length;
      const localTagN = (local.tags || []).length;
      // Aggiorna se revision più nuova OPPURE il seed ha molti più tag (fix catalogo/OCR)
      if (seedRev > localRev || seedTagN > localTagN + 3) {
        const locked = new Map(
          (local.tags || [])
            .filter((t) => t.locked || t.source === "manual")
            .map((t) => [String(t.id).toUpperCase(), t])
        );
        const bySeed = new Map(
          (seed.tags || []).map((t) => [String(t.id).toUpperCase(), { ...t }])
        );
        // parti dal seed, poi aggiungi manuali mancanti; se manuale e seed coincidono tieni manuale
        const merged = [];
        const seen = new Set();
        for (const [key, t] of bySeed) {
          const keep = locked.get(key);
          merged.push(keep ? { ...t, ...keep, id: keep.id } : t);
          seen.add(key);
        }
        for (const [key, t] of locked) {
          if (!seen.has(key)) merged.push(t);
        }
        local.image = seed.image || local.image;
        local.width = seed.width || local.width;
        local.height = seed.height || local.height;
        local.cropLeft = seed.cropLeft ?? local.cropLeft ?? 0;
        local.name = seed.name || local.name;
        local.area = seed.area || local.area;
        local.notes = seed.notes || local.notes;
        local.seedRev = Math.max(seedRev, localRev, 1);
        local.tags = merged;
        local.updatedAt = Date.now();
        await idbPut(local);
        byId.set(seed.id, local);
        continue;
      }

      const cropLeft = Number(seed.cropLeft) || 0;
      if (
        cropLeft > 0 &&
        local.width &&
        seed.width &&
        local.width > seed.width &&
        local.width - seed.width === cropLeft
      ) {
        local.tags = remapTagsAfterCrop(local.tags, cropLeft, local.width, seed.width);
        local.width = seed.width;
        local.height = seed.height;
        local.cropLeft = cropLeft;
        changed = true;
      }

      if (seed.image && local.image !== seed.image) {
        local.image = seed.image;
        changed = true;
      }
      if (seed.width && local.width !== seed.width && !changed) {
        local.width = seed.width;
        local.height = seed.height;
        local.cropLeft = seed.cropLeft;
        if (!(local.tags || []).length) local.tags = seed.tags || [];
        changed = true;
      }
      if (seed.name && local.name !== seed.name) {
        local.name = seed.name;
        changed = true;
      }
      if (seed.area && local.area !== seed.area) {
        local.area = seed.area;
        changed = true;
      }

      if (changed) {
        local.updatedAt = Date.now();
        await idbPut(local);
      }
    } catch (err) {
      console.warn("Seed mappa non caricato:", path, err);
    }
  }

  return idbGetAll();
}

/**
 * Forza merge dei seed dal sito (tiene i tag manual/locked).
 * Usato dal pulsante Aggiorna.
 */
export async function forceReloadSeeds() {
  const existing = await idbGetAll();
  const byId = new Map(existing.map((m) => [m.id, m]));
  const paths = await resolveSeedPaths();
  let updated = 0;

  for (const path of paths) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) continue;
      const seed = await res.json();
      if (!seed?.id) continue;
      const local = byId.get(seed.id);
      if (!local) {
        seed.updatedAt = Date.now();
        await idbPut(seed);
        byId.set(seed.id, seed);
        updated += 1;
        continue;
      }
      const locked = new Map(
        (local.tags || [])
          .filter((t) => t.locked || t.source === "manual")
          .map((t) => [String(t.id).toUpperCase(), t])
      );
      const bySeed = new Map(
        (seed.tags || []).map((t) => [String(t.id).toUpperCase(), { ...t }])
      );
      const merged = [];
      const seen = new Set();
      for (const [key, t] of bySeed) {
        const keep = locked.get(key);
        merged.push(keep ? { ...t, ...keep, id: keep.id } : t);
        seen.add(key);
      }
      for (const [key, t] of locked) {
        if (!seen.has(key)) merged.push(t);
      }
      local.image = seed.image || local.image;
      local.width = seed.width || local.width;
      local.height = seed.height || local.height;
      local.cropLeft = seed.cropLeft ?? local.cropLeft ?? 0;
      local.name = seed.name || local.name;
      local.area = seed.area || local.area;
      local.notes = seed.notes || local.notes;
      local.seedRev = Math.max(Number(seed.seedRev) || 0, Number(local.seedRev) || 0, 1);
      local.tags = merged;
      local.updatedAt = Date.now();
      await idbPut(local);
      byId.set(seed.id, local);
      updated += 1;
    } catch (err) {
      console.warn("forceReloadSeeds", path, err);
    }
  }
  return { updated, maps: await idbGetAll() };
}

/** Cancella le mappe locali e ricarica i seed dal sito (ripristino). */
export async function resetMapsFromSeed() {
  const db = await openIdb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return loadSeedIfEmpty();
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

/** Confronti ricerca: ignora spazi, -, _, punti e maiuscole (tk 11002 ≈ TK-11002 ≈ tk11002). */
export function normalizeSearchKey(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function tagSearchKeys(tag) {
  const id = String(tag.id || "");
  const label = String(tag.label || "");
  const note = String(tag.note || "").trim();
  const keys = new Set();
  keys.add(normalizeSearchKey(id));
  keys.add(normalizeSearchKey(label));
  const codePart = label.split(/\s+/)[0] || "";
  if (codePart) keys.add(normalizeSearchKey(codePart));
  // Nota: tutta la dicitura + singole parole (≥3) per ritrovare dalla descrizione
  if (note) {
    keys.add(normalizeSearchKey(note));
    for (const word of note.split(/[\s,;./\\|+]+/)) {
      if (word.length >= 3) keys.add(normalizeSearchKey(word));
    }
  }
  return [...keys].filter(Boolean);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Punteggio 0–100 + motivo leggibile per suggerimenti “intelligenti”. */
function scoreAgainstKey(q, key) {
  if (!q || !key) return null;
  if (key === q) {
    return { score: 100, tier: "exact", reason: "Corrispondenza esatta" };
  }
  if (key.startsWith(q)) {
    return {
      score: 92 - Math.min(10, key.length - q.length),
      tier: "exact",
      reason: "Inizia con la sigla digitata",
    };
  }
  if (q.startsWith(key) && key.length >= 4) {
    return {
      score: 88,
      tier: "exact",
      reason: "Sigla più corta, stesso inizio",
    };
  }
  if (key.includes(q) && q.length >= 3) {
    return {
      score: 82,
      tier: "exact",
      reason: "Contiene la sequenza digitata",
    };
  }
  if (q.includes(key) && key.length >= 4) {
    return {
      score: 78,
      tier: "near",
      reason: "Hai digitato più caratteri del necessario",
    };
  }

  const dist = levenshtein(q, key);
  const maxLen = Math.max(q.length, key.length);
  const sim = 1 - dist / maxLen;

  // 1–2 caratteri di differenza (trattino già ignorato in normalize)
  if (q.length >= 4 && dist <= 2) {
    return {
      score: Math.round(70 - dist * 8 + sim * 15),
      tier: "near",
      reason:
        dist === 1
          ? "Sigla vicina (forse 1 carattere diverso / mancante)"
          : "Sigla simile (piccola differenza)",
    };
  }
  if (q.length >= 5 && sim >= 0.75) {
    return {
      score: Math.round(55 + sim * 20),
      tier: "near",
      reason: "Possibile corrispondenza per somiglianza",
    };
  }

  // stesso “nucleo” numerico: TK11002 vs 11002 o P11100A vs 11100A
  const qDigits = q.replace(/\D/g, "");
  const kDigits = key.replace(/\D/g, "");
  if (qDigits.length >= 4 && kDigits.includes(qDigits)) {
    return {
      score: 74,
      tier: "near",
      reason: "Stesso numero di tag, prefisso diverso o assente",
    };
  }
  if (kDigits.length >= 4 && qDigits.includes(kDigits) && q.length >= 4) {
    return {
      score: 72,
      tier: "near",
      reason: "Numero interno della sigla riconosciuto",
    };
  }

  return null;
}

function bestScoreForTag(q, keys) {
  let best = null;
  for (const key of keys) {
    const s = scoreAgainstKey(q, key);
    if (!s) continue;
    if (!best || s.score > best.score) best = { ...s, key };
  }
  return best;
}

/**
 * Ricerca intelligente: match normalizzati + proposte vicine con motivo.
 * @returns {Promise<Array<{mapId,mapName,tag,match:{score,tier,reason}}>>}
 */
export async function searchAllTags(query) {
  const qRaw = String(query || "").trim();
  const q = normalizeSearchKey(qRaw);
  if (!q || q.length < 2) return [];

  const maps = await listMaps();
  const hits = [];
  for (const map of maps) {
    for (const tag of map.tags || []) {
      const keys = tagSearchKeys(tag);
      const match = bestScoreForTag(q, keys);
      if (!match || match.score < 55) continue;
      hits.push({
        mapId: map.id,
        mapName: map.name,
        tag,
        match: {
          score: match.score,
          tier: match.tier,
          reason: match.reason,
        },
      });
    }
  }

  hits.sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    if (a.match.tier !== b.match.tier) return a.match.tier === "exact" ? -1 : 1;
    return String(a.tag.id).localeCompare(String(b.tag.id), "it");
  });

  // Se ci sono match “exact”, tieni anche i near ma dopo; limita rumore
  const exactCount = hits.filter((h) => h.match.tier === "exact").length;
  if (exactCount >= 8) {
    return hits.filter((h) => h.match.tier === "exact").slice(0, 40);
  }
  return hits.slice(0, 40);
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
