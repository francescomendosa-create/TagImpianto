import {
  initCloud,
  isCloudReady,
  loadSeedIfEmpty,
  listMaps,
  getMap,
  saveMap,
  searchAllTags,
  pullMapsFromCloud,
} from "./db.js";
import { MapViewer } from "./viewer.js";

const $ = (sel) => document.querySelector(sel);

const els = {
  mapSelect: $("#mapSelect"),
  searchInput: $("#searchInput"),
  clearBtn: $("#clearBtn"),
  suggestions: $("#suggestions"),
  status: $("#status"),
  btnAnnotate: $("#btnAnnotate"),
  btnShowAll: $("#btnShowAll"),
  btnFit: $("#btnFit"),
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

viewer.onAnnotatePlace = (x, y) => {
  openNoteDrawer({
    id: "",
    label: "",
    kind: "altro",
    x: Math.max(0, x - 0.02),
    y: Math.max(0, y - 0.02),
    w: 0.04,
    h: 0.06,
    note: "",
    isNew: true,
  });
};

viewer.onTagMoved = async (tagId) => {
  activeTagId = tagId;
  await persistCurrent();
  toast("Posizione aggiornata");
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

async function selectMap(id, { keepHighlight = false } = {}) {
  const map = await getMap(id);
  if (!map) return;
  currentMap = map;
  fillMapSelect();
  await viewer.loadMap(map);
  if (!keepHighlight) {
    activeTagId = null;
    viewer.highlight(null);
  } else if (activeTagId) {
    viewer.highlight(activeTagId);
  }
  setStatus(
    `Mappa: <strong>${escapeHtml(map.name)}</strong> · ${(map.tags || []).length} tag`
  );
}

async function refreshMaps() {
  maps = await listMaps();
  fillMapSelect();
  if (!currentMap && maps[0]) await selectMap(maps[0].id);
  else if (currentMap) {
    const fresh = maps.find((m) => m.id === currentMap.id);
    if (fresh) currentMap = fresh;
  }
}

async function persistCurrent() {
  if (!currentMap) return;
  await saveMap(currentMap);
  maps = await listMaps();
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
    if (query.trim()) setStatus(`Nessun tag per «${escapeHtml(query)}»`);
    return hits;
  }

  els.suggestions.innerHTML = hits
    .slice(0, 40)
    .map(
      (h, i) => `
      <div class="sug-item${i === 0 && autoPick ? " active" : ""}" data-i="${i}" data-map="${escapeHtml(h.mapId)}" data-tag="${escapeHtml(h.tag.id)}">
        <div>
          <div>${escapeHtml(h.tag.label || h.tag.id)}</div>
          <div class="kind">${escapeHtml(h.tag.kind || "")}</div>
        </div>
        <div class="map">${escapeHtml(h.mapName)}</div>
      </div>`
    )
    .join("");
  els.suggestions.classList.add("open");
  sugIndex = 0;

  els.suggestions.querySelectorAll(".sug-item").forEach((el) => {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pickHit(hits[Number(el.dataset.i)]);
    });
  });

  if (autoPick && hits.length === 1) {
    await pickHit(hits[0]);
  }
  return hits;
}

async function pickHit(hit) {
  closeSuggestions();
  els.searchInput.value = hit.tag.label || hit.tag.id;
  els.clearBtn.classList.add("visible");
  if (!currentMap || currentMap.id !== hit.mapId) {
    await selectMap(hit.mapId, { keepHighlight: true });
  } else {
    currentMap = await getMap(hit.mapId);
  }
  activeTagId = hit.tag.id;
  viewer.highlight(hit.tag.id, { center: true });
  const note = hit.tag.note ? ` · nota: ${escapeHtml(hit.tag.note)}` : "";
  setStatus(
    `Trovato <strong>${escapeHtml(hit.tag.label || hit.tag.id)}</strong> in ${escapeHtml(hit.mapName)}${note}`
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
  await persistCurrent();
  activeTagId = id;
  viewer.map = currentMap;
  viewer.highlight(id, { center: false });
  viewer.renderOverlay();
  closeDrawer();
  toast(isNew ? "Tag aggiunto" : "Tag salvato");
  setStatus(`Mappa: <strong>${escapeHtml(currentMap.name)}</strong> · ${currentMap.tags.length} tag`);
});

els.noteDelete.addEventListener("click", async () => {
  if (!currentMap) return;
  const id = els.drawer.dataset.tagId;
  currentMap.tags = (currentMap.tags || []).filter((t) => t.id !== id);
  await persistCurrent();
  if (activeTagId === id) activeTagId = null;
  viewer.map = currentMap;
  viewer.highlight(null);
  viewer.renderOverlay();
  closeDrawer();
  toast("Tag eliminato");
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

els.btnShowAll.addEventListener("click", () => {
  const on = !viewer.showAll;
  viewer.setShowAll(on);
  els.btnShowAll.classList.toggle("active", on);
});

els.btnAnnotate.addEventListener("click", () => {
  annotateMode = !annotateMode;
  viewer.setAnnotate(annotateMode);
  els.btnAnnotate.classList.toggle("active", annotateMode);
  toast(annotateMode ? "Annota: tap sulla mappa per nuovo tag" : "Annotazione off");
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
    toast("Configura Firebase in js/firebase-config.js");
    return;
  }
  els.btnSync.disabled = true;
  try {
    if (currentMap) await saveMap(currentMap, { sync: true });
    await pullMapsFromCloud();
    await refreshMaps();
    if (currentMap) await selectMap(currentMap.id, { keepHighlight: true });
    toast("Sincronizzato con Firestore");
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

window.addEventListener("resize", () => {
  if (currentMap) viewer.fit();
});

async function boot() {
  setStatus("Avvio Tag Impianto…");
  await loadSeedIfEmpty();
  await refreshMaps();

  const cloud = await initCloud();
  if (cloud.ok) {
    els.cloudBadge.innerHTML = `<span class="ok">Cloud pronto</span>`;
    try {
      await pullMapsFromCloud();
      await refreshMaps();
      if (currentMap) await selectMap(currentMap.id);
    } catch (err) {
      console.warn(err);
    }
  } else {
    els.cloudBadge.innerHTML = `<span class="warn">Locale</span>`;
  }

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (_) {
      /* ignore */
    }
  }

  els.searchInput.focus();
}

boot().catch((err) => {
  console.error(err);
  setStatus(`Errore avvio: ${escapeHtml(err.message || err)}`);
});
