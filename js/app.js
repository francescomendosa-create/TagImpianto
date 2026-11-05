import {
  initCloud,
  isCloudReady,
  loadSeedIfEmpty,
  resetMapsFromSeed,
  forceReloadSeeds,
  listMaps,
  getMap,
  saveMap,
  searchAllTags,
  pullMapsFromCloud,
  syncAllWithCloud,
  pushLocalChangesToCloud,
} from "./db.js?v=1.6.5";
import { MapViewer } from "./viewer.js?v=1.6.5";
import { runMapOcr, mergeOcrIntoMap } from "./ocr.js?v=1.6.5";
import { renderPlantNav, setPlantNavActive } from "./plant-nav.js?v=1.6.5";
import { APP_VERSION, APP_BUILD } from "./version.js?v=1.6.5";
import { warmAllMapImages, countLocalImages } from "./image-cache.js?v=1.6.5";

const $ = (sel) => document.querySelector(sel);

const els = {
  mapSelect: $("#mapSelect"),
  mapTitle: $("#mapTitle"),
  plantNav: $("#plantNav"),
  searchInput: $("#searchInput"),
  clearBtn: $("#clearBtn"),
  suggestions: $("#suggestions"),
  status: $("#status"),
  btnAnnotate: $("#btnAnnotate"),
  btnOcr: $("#btnOcr"),
  btnFit: $("#btnFit"),
  btnRefresh: $("#btnRefresh"),
  btnSync: $("#btnSync"),
  btnNotes: $("#btnNotes"),
  drawer: $("#drawer"),
  noteTitle: $("#noteTitle"),
  noteBody: $("#noteBody"),
  noteKind: $("#noteKind"),
  noteSave: $("#noteSave"),
  noteDelete: $("#noteDelete"),
  noteClose: $("#noteClose"),
  toast: $("#toast"),
  cloudBadge: $("#cloudBadge"),
  appVersion: $("#appVersion"),
};

let maps = [];
let currentMap = null;
let activeTagId = null;
let annotateMode = false;
let sugIndex = -1;
let toastTimer = 0;

const viewer = new MapViewer({
  viewport: $("#viewport"),
  world: $("#world"),
  imageEl: $("#mapImage"),
  overlayEl: $("#overlay"),
});

// Riposiziona: niente nuovi tag al tap — solo trascinamento del tag evidenziato
viewer.onAnnotatePlace = null;

viewer.onTagMoved = async (tagId) => {
  activeTagId = tagId;
  const tag = currentMap?.tags?.find((t) => t.id === tagId);
  if (tag) {
    tag.source = "manual";
    tag.locked = true;
    tag.updatedAt = Date.now();
  }
  const { cloudSynced } = await persistCurrent();
  toast(
    cloudSynced
      ? "Posizione salvata (locale + cloud)"
      : isCloudReady()
        ? "Posizione locale — cloud fallito, riprova Sync"
        : "Posizione salvata solo su questo dispositivo"
  );
};

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function setStatus(html) {
  els.status.innerHTML = html;
}

function fillMapSelect() {
  els.mapSelect.innerHTML = "";
  for (const m of maps) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name || m.id;
    els.mapSelect.appendChild(opt);
  }
  if (currentMap) els.mapSelect.value = currentMap.id;
}

function syncPlantChrome(map) {
  fillMapSelect();
  setPlantNavActive(els.plantNav, map?.id || null);
  if (els.mapTitle) {
    els.mapTitle.innerHTML = map
      ? `<strong>${escapeHtml(map.name)}</strong>`
      : "";
  }
}

async function selectMap(id, { keepHighlight = false, keepView = false } = {}) {
  const map = await getMap(id);
  if (!map) {
    toast("Mappa non disponibile");
    return;
  }
  const same = currentMap && currentMap.id === map.id;
  currentMap = map;
  // UI subito (titolo/menu), poi immagine
  syncPlantChrome(map);
  setStatus(`Mappa: <strong>${escapeHtml(map.name)}</strong> · ${(map.tags || []).length} tag`);
  if (!keepHighlight) {
    activeTagId = null;
    viewer.highlight(null);
  }
  try {
    await viewer.loadMap(map, { keepView: keepView || (keepHighlight && same) });
  } catch (err) {
    setStatus(`Errore immagine: ${escapeHtml(err.message || err)}`);
    return;
  }
  if (keepHighlight && activeTagId) viewer.highlight(activeTagId);
  // Precarica le mappe vicine nel menu
  preloadNearby(id);
}

function preloadNearby(mapId) {
  const ids = maps.map((m) => m.id);
  const i = ids.indexOf(mapId);
  const neighbors = [ids[i - 1], ids[i + 1], ids[i + 2]].filter(Boolean);
  for (const nid of neighbors) {
    const m = maps.find((x) => x.id === nid);
    if (m?.image) viewer.preload(m.image);
  }
}

function setMapsLocalBadge(n) {
  const cloud = isCloudReady() ? `<span class="ok">Cloud</span> · ` : "";
  els.cloudBadge.innerHTML =
    `${cloud}<span class="ok" title="PNG salvate su questo dispositivo">Mappe in locale (${n})</span>`;
}

async function syncImagesLocal() {
  const already = await countLocalImages().catch(() => 0);
  const total = maps.filter((m) => m?.image).length;
  if (total && already >= total) {
    setMapsLocalBadge(already);
    return;
  }
  setStatus(`Salvo le mappe sul dispositivo… 0/${total}`);
  await warmAllMapImages(maps, (done, tot, name) => {
    setStatus(
      `Salvo le mappe sul dispositivo… <strong>${done}/${tot}</strong>` +
        (name ? ` · ${escapeHtml(name)}` : "")
    );
  });
  const n = await countLocalImages().catch(() => total);
  setMapsLocalBadge(n);
  if (currentMap) {
    setStatus(
      `Mappa: <strong>${escapeHtml(currentMap.name)}</strong> · ${(currentMap.tags || []).length} tag`
    );
  } else {
    setStatus("Mappe pronte in locale");
  }
}

async function refreshMaps() {
  maps = await listMaps();
  syncPlantChrome(currentMap);
  if (!currentMap) {
    const prefer =
      maps.find((m) => m.id === "ultrafiltrazione-mbr-ad") ||
      maps.find((m) => m.id === "biologico-mbbr-123") ||
      maps[0];
    if (prefer) await selectMap(prefer.id);
  } else {
    const fresh = maps.find((m) => m.id === currentMap.id);
    if (fresh) {
      currentMap = fresh;
      syncPlantChrome(currentMap);
    }
  }
}

async function persistCurrent() {
  if (!currentMap) return { cloudSynced: false, cloudError: null };
  const result = await saveMap(currentMap);
  currentMap = result.map;
  maps = await listMaps();
  return result;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function closeSuggestions() {
  els.suggestions.classList.remove("open");
  els.suggestions.innerHTML = "";
  sugIndex = -1;
}

async function runSearch(query, { autoPick = false } = {}) {
  const hits = await searchAllTags(query);
  if (!hits.length) {
    closeSuggestions();
    if (query.trim()) {
      setStatus(
        `Nessuna sigla vicina a «${escapeHtml(query)}» — apri la mappa e premi <strong>OCR</strong>, oppure prova senza trattini (es. tk11007)`
      );
    }
    return hits;
  }

  const exactN = hits.filter((h) => h.match?.tier === "exact").length;
  const nearN = hits.length - exactN;

  els.suggestions.innerHTML = hits
    .slice(0, 40)
    .map((h, i) => {
      const tier = h.match?.tier || "exact";
      const reason = h.match?.reason || "";
      const badge = tier === "near" ? "Vicino" : "Match";
      const noteText = String(h.tag.note || "").trim();
      const noteHtml = noteText
        ? `<div class="sug-note">${escapeHtml(noteText)}</div>`
        : "";
      return `
      <div class="sug-item sug-${tier}${i === 0 ? " active" : ""}" data-i="${i}" data-map="${escapeHtml(h.mapId)}" data-tag="${escapeHtml(h.tag.id)}">
        <div>
          <div class="sug-title">
            <span>${escapeHtml(h.tag.label || h.tag.id)}</span>
            <span class="sug-badge ${tier}">${badge}</span>
          </div>
          ${noteHtml}
          <div class="kind">${escapeHtml(h.tag.kind || "")}</div>
          <div class="sug-reason">${escapeHtml(reason)}</div>
        </div>
        <div class="map">${escapeHtml(h.mapName)}</div>
      </div>`;
    })
    .join("");
  els.suggestions.classList.add("open");
  sugIndex = 0;

  els.suggestions.querySelectorAll(".sug-item").forEach((el) => {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pickHit(hits[Number(el.dataset.i)]);
    });
  });

  if (exactN && nearN) {
    setStatus(
      `<strong>${exactN}</strong> corrispondenze · <strong>${nearN}</strong> proposte vicine — scegli dalla lista`
    );
  } else if (!exactN && nearN) {
    setStatus(
      `Nessun match esatto — <strong>${nearN}</strong> sigle vicine, scegli quella giusta`
    );
  } else {
    setStatus(`<strong>${exactN}</strong> risultati — seleziona o Invio`);
  }

  // Auto-pick solo se un unico match esatto (non sulle sole proposte “vicine”)
  if (autoPick && exactN === 1 && hits[0].match?.tier === "exact") {
    await pickHit(hits[0]);
  }
  return hits;
}

async function pickHit(hit) {
  closeSuggestions();
  els.searchInput.value = hit.tag.label || hit.tag.id;
  els.clearBtn.classList.add("visible");
  if (!currentMap || currentMap.id !== hit.mapId) {
    // nuova mappa: un solo fit iniziale; sulla stessa mappa non si tocca lo zoom
    await selectMap(hit.mapId, { keepHighlight: true });
  } else {
    currentMap = await getMap(hit.mapId);
    viewer.map = currentMap;
  }
  activeTagId = hit.tag.id;
  viewer.highlight(hit.tag.id);
  const note = hit.tag.note ? ` · nota: ${escapeHtml(hit.tag.note)}` : "";
  const why = hit.match?.reason ? ` · ${escapeHtml(hit.match.reason)}` : "";
  setStatus(
    `Evidenziato <strong>${escapeHtml(hit.tag.label || hit.tag.id)}</strong> in ${escapeHtml(hit.mapName)}${why}${note}`
  );
}

function openNoteDrawer(tag) {
  els.drawer.classList.add("open");
  els.noteTitle.value = tag.label || tag.id || "";
  els.noteBody.value = tag.note || "";
  els.noteKind.value = tag.kind || "altro";
  els.drawer.dataset.tagId = tag.id || "";
  els.drawer.dataset.isNew = tag.isNew ? "1" : "0";
  els.drawer.dataset.x = String(tag.x);
  els.drawer.dataset.y = String(tag.y);
  els.drawer.dataset.w = String(tag.w);
  els.drawer.dataset.h = String(tag.h);
  els.noteDelete.style.display = tag.isNew ? "none" : "inline-block";
}

function closeDrawer() {
  els.drawer.classList.remove("open");
}

els.noteClose.addEventListener("click", closeDrawer);

els.noteSave.addEventListener("click", async () => {
  if (!currentMap) return;
  const label = els.noteTitle.value.trim();
  if (!label) {
    toast("Inserisci la sigla / tag");
    return;
  }
  const id =
    els.drawer.dataset.tagId ||
    label.replace(/\s+/g, "-").toUpperCase();
  const isNew = els.drawer.dataset.isNew === "1";
  let tag = (currentMap.tags || []).find((t) => t.id === id);
  if (!tag) {
    tag = {
      id,
      x: Number(els.drawer.dataset.x) || 0.4,
      y: Number(els.drawer.dataset.y) || 0.4,
      w: Number(els.drawer.dataset.w) || 0.04,
      h: Number(els.drawer.dataset.h) || 0.06,
    };
    currentMap.tags = currentMap.tags || [];
    if (isNew || !(currentMap.tags || []).some((t) => t.id === id)) {
      currentMap.tags.push(tag);
    }
  }
  tag.id = id;
  tag.label = label;
  tag.kind = els.noteKind.value;
  tag.note = els.noteBody.value.trim();
  tag.source = "manual";
  tag.locked = true;
  tag.updatedAt = Date.now();
  const { cloudSynced } = await persistCurrent();
  activeTagId = id;
  viewer.map = currentMap;
  viewer.highlight(id);
  closeDrawer();
  if (cloudSynced) {
    toast(isNew ? "Tag + nota online" : "Nota salvata online");
  } else if (isCloudReady()) {
    toast("Salvata in locale — cloud fallito, premi Sync");
  } else {
    toast(isNew ? "Tag salvato solo qui" : "Nota salvata solo qui");
  }
  setStatus(`Mappa: <strong>${escapeHtml(currentMap.name)}</strong> · ${currentMap.tags.length} tag`);
});

els.noteDelete.addEventListener("click", async () => {
  if (!currentMap) return;
  const id = els.drawer.dataset.tagId;
  currentMap.tags = (currentMap.tags || []).filter((t) => t.id !== id);
  const { cloudSynced } = await persistCurrent();
  if (activeTagId === id) activeTagId = null;
  viewer.map = currentMap;
  viewer.highlight(null);
  viewer.renderOverlay();
  closeDrawer();
  toast(cloudSynced ? "Tag eliminato (anche online)" : "Tag eliminato in locale");
});

els.mapSelect.addEventListener("change", () => selectMap(els.mapSelect.value));

els.searchInput.addEventListener("input", async () => {
  const q = els.searchInput.value;
  els.clearBtn.classList.toggle("visible", !!q);
  if (!q.trim()) {
    closeSuggestions();
    viewer.highlight(null);
    return;
  }
  await runSearch(q);
});

els.searchInput.addEventListener("keydown", async (e) => {
  const items = [...els.suggestions.querySelectorAll(".sug-item")];
  if (e.key === "ArrowDown" && items.length) {
    e.preventDefault();
    sugIndex = Math.min(items.length - 1, sugIndex + 1);
    items.forEach((el, i) => el.classList.toggle("active", i === sugIndex));
    items[sugIndex]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "ArrowUp" && items.length) {
    e.preventDefault();
    sugIndex = Math.max(0, sugIndex - 1);
    items.forEach((el, i) => el.classList.toggle("active", i === sugIndex));
  } else if (e.key === "Enter") {
    e.preventDefault();
    const hits = await searchAllTags(els.searchInput.value);
    if (!hits.length) {
      toast("Nessun risultato");
      return;
    }
    const pick = sugIndex >= 0 && hits[sugIndex] ? hits[sugIndex] : hits[0];
    await pickHit(pick);
  } else if (e.key === "Escape") {
    closeSuggestions();
  }
});

els.clearBtn.addEventListener("click", () => {
  els.searchInput.value = "";
  els.clearBtn.classList.remove("visible");
  closeSuggestions();
  viewer.highlight(null);
  els.searchInput.focus();
});

els.btnFit.addEventListener("click", () => viewer.fit());

els.btnRefresh?.addEventListener("click", async () => {
  els.btnRefresh.disabled = true;
  setStatus("Aggiornamento dal sito…");
  try {
    const { updated } = await forceReloadSeeds();
    await refreshMaps();
    if (currentMap) {
      await selectMap(currentMap.id, { keepHighlight: true, keepView: true });
    }
    toast(`Aggiornato (${updated} mappe)`);
  } catch (err) {
    toast(`Aggiorna fallito: ${err.message || err}`);
    setStatus(`Errore aggiornamento: ${escapeHtml(err.message || err)}`);
  } finally {
    els.btnRefresh.disabled = false;
  }
});

els.btnAnnotate.addEventListener("click", () => {
  if (!annotateMode && !activeTagId) {
    toast("Prima cerca ed evidenzia una sigla");
    return;
  }
  annotateMode = !annotateMode;
  viewer.setAnnotate(annotateMode);
  els.btnAnnotate.classList.toggle("active", annotateMode);
  if (annotateMode) {
    viewer.highlight(activeTagId);
    toast("Trascina solo il riquadro evidenziato");
  } else {
    toast("Riposiziona off");
  }
});

els.btnOcr.addEventListener("click", async () => {
  const img = $("#mapImage");
  if (!currentMap || !img?.naturalWidth) {
    toast("Carica una mappa prima");
    return;
  }
  els.btnOcr.disabled = true;
  els.btnOcr.classList.add("active");
  setStatus("OCR in corso… primo avvio può scaricare il motore (~minuto)");
  try {
    const found = await runMapOcr(img, {
      onProgress: (p) => {
        setStatus(`OCR… <strong>${Math.round(p * 100)}%</strong>`);
      },
    });
    const { tags, added, updated, skipped } = mergeOcrIntoMap(currentMap, found);
    currentMap.tags = tags;
    await persistCurrent();
    viewer.map = currentMap;
    viewer.renderOverlay();
    setStatus(
      `OCR: <strong>${found.length}</strong> letti · +${added} nuovi · ${updated} aggiornati · ${skipped} bloccati (manuali). Cerca una sigla per evidenziarla.`
    );
    toast("OCR finito — cerca una sigla per vederla");
  } catch (err) {
    console.warn(err);
    setStatus(`OCR fallita: ${escapeHtml(err.message || err)}`);
    toast("OCR fallita");
  } finally {
    els.btnOcr.disabled = false;
    els.btnOcr.classList.remove("active");
  }
});

els.btnNotes.addEventListener("click", () => {
  if (!activeTagId || !currentMap) {
    toast("Cerca o seleziona un tag prima");
    return;
  }
  const tag = currentMap.tags.find((t) => t.id === activeTagId);
  if (tag) openNoteDrawer({ ...tag, isNew: false });
});

els.btnSync.addEventListener("click", async () => {
  if (!isCloudReady()) {
    toast("Cloud non attivo: serve Firebase (vedi firebase-config)");
    return;
  }
  els.btnSync.disabled = true;
  setStatus("Sincronizzazione cloud…");
  try {
    const n = await syncAllWithCloud();
    await refreshMaps();
    if (currentMap) await selectMap(currentMap.id, { keepHighlight: true, keepView: true });
    toast(`Cloud sync ok (${n} mappe)`);
    els.cloudBadge.innerHTML = `<span class="ok">Cloud sync</span>`;
  } catch (err) {
    toast("Sync fallita");
    console.warn(err);
  } finally {
    els.btnSync.disabled = false;
  }
});

document.addEventListener("click", (e) => {
  if (!els.suggestions.contains(e.target) && e.target !== els.searchInput) {
    closeSuggestions();
  }
});

// resize: non forzare fit — l’inquadratura resta quella dell’utente

async function boot() {
  if (els.appVersion) {
    els.appVersion.textContent = `v${APP_VERSION}`;
    els.appVersion.title = `Versione ${APP_VERSION} (${APP_BUILD})`;
  }
  setStatus("Avvio Tag Impianto…");
  renderPlantNav(els.plantNav, {
    onSelect: (page) => {
      if (page?.mapId) selectMap(page.mapId);
    },
  });

  const params = new URLSearchParams(location.search);
  const wantReset = params.has("reset") || params.get("ripristina") === "1";
  if (wantReset) {
    setStatus("Ripristino mappe e tag dal sito…");
    await resetMapsFromSeed();
  } else {
    await loadSeedIfEmpty();
  }

  await refreshMaps();

  // Se dopo il load non c’è nulla, forza ripristino seed (cache/IndexedDB corrotti)
  if (!maps.length) {
    setStatus("Nessuna mappa in locale — ripristino…");
    await resetMapsFromSeed();
    await refreshMaps();
  }

  const cloud = await initCloud();
  if (cloud.ok) {
    els.cloudBadge.innerHTML = `<span class="ok">Cloud…</span>`;
    try {
      setStatus("Allineo dati dal cloud…");
      await pullMapsFromCloud();
      // Porta subito online note e modifiche già presenti sul dispositivo
      await pushLocalChangesToCloud();
      await refreshMaps();
      if (currentMap) await selectMap(currentMap.id);
      els.cloudBadge.innerHTML = `<span class="ok">Cloud attivo</span>`;
    } catch (err) {
      console.warn(err);
      els.cloudBadge.innerHTML = `<span class="warn">Cloud errore</span>`;
    }
  } else {
    els.cloudBadge.innerHTML = `<span class="muted" title="Riposizionamenti solo su questo dispositivo">Solo dispositivo</span>`;
  }

  window.addEventListener("online", () => {
    if (!isCloudReady()) return;
    pushLocalChangesToCloud().catch((err) => console.warn(err));
  });

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
    } catch (_) {
      /* ignore */
    }
  }

  // Prima mappa subito usabile; in background scarica TUTTE le PNG in IndexedDB
  if (currentMap) preloadNearby(currentMap.id);
  syncImagesLocal().catch((err) => console.warn(err));
  els.searchInput.focus();
}

boot().catch((err) => {
  console.error(err);
  setStatus(`Errore avvio: ${escapeHtml(err.message || err)}`);
});
