import { resolveLocalImageUrl } from "./image-cache.js?v=1.7.4";

const MAX_MEM_IMAGES = 10;

export class MapViewer {
  constructor({ viewport, world, imageEl, overlayEl }) {
    this.viewport = viewport;
    this.world = world;
    this.imageEl = imageEl;
    this.overlayEl = overlayEl;

    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.map = null;
    this.highlightId = null;
    this.annotate = false;
    this._viewInitialized = false;
    /** URL logica remota (non blob:) */
    this._lastRemote = "";
    /** @type {Map<string, string>} remote -> display url */
    this._resolved = new Map();
    this._loadToken = 0;

    this._pointers = new Map();
    this._lastPinch = null;
    this._panning = false;
    this._dragTag = null;

    this.onAnnotatePlace = null;
    this.onTagMoved = null;
    /** Doppio tap/click su un tag esistente → ricerca */
    this.onTagDoubleSelect = null;
    this._lastTap = null;

    this._bind();
  }

  _bind() {
    const vp = this.viewport;
    vp.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    vp.addEventListener("pointermove", (e) => this._onPointerMove(e));
    vp.addEventListener("pointerup", (e) => this._onPointerUp(e));
    vp.addEventListener("pointercancel", (e) => this._onPointerUp(e));
    vp.addEventListener("dblclick", (e) => {
      e.preventDefault();
      this._emitTagDoubleSelect(e.clientX, e.clientY);
    });
    vp.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = vp.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.zoomAt(cx, cy, factor);
      },
      { passive: false }
    );
  }

  _emitTagDoubleSelect(clientX, clientY) {
    if (!this.onTagDoubleSelect) return;
    const now = Date.now();
    if (this._lastEmitSelect && now - this._lastEmitSelect < 450) return;
    const tag = this.findTagAtClient(clientX, clientY);
    if (!tag) return;
    this._lastEmitSelect = now;
    this.onTagDoubleSelect(tag);
  }

  /** Tag sotto le coordinate schermo (hit-test su tutti i tag della mappa). */
  findTagAtClient(clientX, clientY) {
    if (!this.map || !this.imageEl?.width) return null;
    const rect = this.viewport.getBoundingClientRect();
    const vx = clientX - rect.left;
    const vy = clientY - rect.top;
    const iw = this.imageEl.width;
    const ih = this.imageEl.height;
    const nx = (vx - this.tx) / this.scale / iw;
    const ny = (vy - this.ty) / this.scale / ih;
    const tags = this.map.tags || [];
    let best = null;
    let bestArea = Infinity;
    for (const t of tags) {
      const x = Number(t.x) || 0;
      const y = Number(t.y) || 0;
      const w = Math.max(Number(t.w) || 0.02, 0.01);
      const h = Math.max(Number(t.h) || 0.02, 0.01);
      // margine touch ~8px in coordinate normalizzate
      const padX = 8 / this.scale / iw;
      const padY = 8 / this.scale / ih;
      if (
        nx >= x - padX &&
        nx <= x + w + padX &&
        ny >= y - padY &&
        ny <= y + h + padY
      ) {
        const area = w * h;
        if (area < bestArea) {
          best = t;
          bestArea = area;
        }
      }
    }
    return best;
  }

  setAnnotate(on) {
    this.annotate = !!on;
    this.viewport.classList.toggle("annotate", this.annotate);
    this.renderOverlay();
  }

  /** Precache in IndexedDB + memoria (non blocca UI). */
  preload(src) {
    if (!src) return;
    resolveLocalImageUrl(src)
      .then((url) => {
        this._resolved.set(src, url);
        const img = new Image();
        img.decoding = "async";
        img.src = url;
      })
      .catch(() => {});
  }

  async _displayUrl(remote) {
    if (this._resolved.has(remote)) return this._resolved.get(remote);
    const url = await resolveLocalImageUrl(remote);
    this._resolved.set(remote, url);
    // Limita mappa risoluzioni tenute in memoria (i blob restano in IDB)
    while (this._resolved.size > MAX_MEM_IMAGES) {
      const first = this._resolved.keys().next().value;
      this._resolved.delete(first);
    }
    return url;
  }

  async loadMap(map, { keepView = false } = {}) {
    this.map = map;
    const remote = map.image;
    const token = ++this._loadToken;
    const sameImage = remote === this._lastRemote && this.imageEl.naturalWidth;

    if (!sameImage) {
      const display = await this._displayUrl(remote);
      if (token !== this._loadToken) return;

      await new Promise((resolve, reject) => {
        const done = () => resolve();
        this.imageEl.onload = done;
        this.imageEl.onerror = () => reject(new Error("Immagine mappa non caricata"));
        if (this.imageEl.src === display && this.imageEl.complete && this.imageEl.naturalWidth) {
          done();
          return;
        }
        this.imageEl.src = display;
      });
      if (token !== this._loadToken) return;
      this._lastRemote = remote;
    }

    const w = map.width || this.imageEl.naturalWidth;
    const h = map.height || this.imageEl.naturalHeight;
    this.imageEl.width = w;
    this.imageEl.height = h;
    this.overlayEl.style.width = `${w}px`;
    this.overlayEl.style.height = `${h}px`;
    if (keepView && sameImage) {
      /* lascia inquadratura */
    } else if (!this._viewInitialized || !sameImage) {
      this.fit();
      this._viewInitialized = true;
    }
    this.renderOverlay();
  }

  fit() {
    if (!this.imageEl.naturalWidth) return;
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const iw = this.imageEl.width;
    const ih = this.imageEl.height;
    const pad = 16;
    this.scale = Math.min((vw - pad) / iw, (vh - pad) / ih, 2);
    this.tx = (vw - iw * this.scale) / 2;
    this.ty = (vh - ih * this.scale) / 2;
    this.applyTransform();
  }

  applyTransform() {
    this.world.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
  }

  zoomAt(cx, cy, factor) {
    const before = this.scale;
    const next = Math.min(8, Math.max(0.2, before * factor));
    const wx = (cx - this.tx) / before;
    const wy = (cy - this.ty) / before;
    this.scale = next;
    this.tx = cx - wx * next;
    this.ty = cy - wy * next;
    this.applyTransform();
  }

  highlight(tagId) {
    this.highlightId = tagId || null;
    this.renderOverlay();
  }

  renderOverlay() {
    const overlay = this.overlayEl;
    overlay.innerHTML = "";
    if (!this.map || !this.highlightId) return;
    const tag = (this.map.tags || []).find((t) => t.id === this.highlightId);
    if (!tag) return;
    const iw = this.imageEl.width;
    const ih = this.imageEl.height;
    const el = document.createElement("div");
    el.className = "tag-box hit";
    if (this.annotate) el.classList.add("edit");
    el.style.left = `${tag.x * iw}px`;
    el.style.top = `${tag.y * ih}px`;
    el.style.width = `${tag.w * iw}px`;
    el.style.height = `${tag.h * ih}px`;
    el.dataset.tagId = tag.id;
    const lab = document.createElement("div");
    lab.className = "label";
    lab.textContent = tag.label || tag.id;
    el.appendChild(lab);
    if (this.annotate) {
      el.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        this._dragTag = {
          id: tag.id,
          startX: e.clientX,
          startY: e.clientY,
          ox: tag.x,
          oy: tag.y,
        };
      });
    }
    overlay.appendChild(el);
  }

  _onPointerDown(e) {
    this.viewport.setPointerCapture(e.pointerId);
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._pointers.size === 2) {
      const pts = [...this._pointers.values()];
      this._lastPinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
      };
    } else if (this._pointers.size === 1 && !this._dragTag) {
      this._panning = true;
      this.viewport.classList.add("panning");
      this._panStart = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
      this._moved = false;
    }
  }

  _onPointerMove(e) {
    if (this._dragTag && this.map) {
      const dx = (e.clientX - this._dragTag.startX) / this.scale / this.imageEl.width;
      const dy = (e.clientY - this._dragTag.startY) / this.scale / this.imageEl.height;
      const tag = this.map.tags.find((t) => t.id === this._dragTag.id);
      if (tag) {
        tag.x = Math.min(1 - tag.w, Math.max(0, this._dragTag.ox + dx));
        tag.y = Math.min(1 - tag.h, Math.max(0, this._dragTag.oy + dy));
        this.renderOverlay();
      }
      return;
    }

    if (!this._pointers.has(e.pointerId)) return;
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pointers.size === 2 && this._lastPinch) {
      const pts = [...this._pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const rect = this.viewport.getBoundingClientRect();
      const cx = (pts[0].x + pts[1].x) / 2 - rect.left;
      const cy = (pts[0].y + pts[1].y) / 2 - rect.top;
      const factor = dist / this._lastPinch.dist;
      this.zoomAt(cx, cy, factor);
      this._lastPinch = { dist, cx, cy };
      this._moved = true;
      return;
    }

    if (this._panning && this._panStart) {
      const dx = e.clientX - this._panStart.x;
      const dy = e.clientY - this._panStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this._moved = true;
      this.tx = this._panStart.tx + dx;
      this.ty = this._panStart.ty + dy;
      this.applyTransform();
    }
  }

  _onPointerUp(e) {
    const wasDrag = this._dragTag;
    const moved = this._moved;
    if (wasDrag) {
      this._dragTag = null;
      if (this.onTagMoved) this.onTagMoved(wasDrag.id);
    }

    this._pointers.delete(e.pointerId);
    if (this._pointers.size < 2) this._lastPinch = null;

    if (this._pointers.size === 0) {
      // Doppio tap (soprattutto touch): due tocchi fermi entro 400ms → tag in ricerca
      if (!wasDrag && !moved && this.onTagDoubleSelect) {
        const now = Date.now();
        const prev = this._lastTap;
        if (
          prev &&
          now - prev.t < 400 &&
          Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 28
        ) {
          this._emitTagDoubleSelect(e.clientX, e.clientY);
          this._lastTap = null;
        } else {
          this._lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      }

      this._panning = false;
      this.viewport.classList.remove("panning");
      this._panStart = null;
      this._moved = false;
    }
  }
}
