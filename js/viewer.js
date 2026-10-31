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
    this.showAll = false;

    this._pointers = new Map();
    this._lastPinch = null;
    this._panning = false;
    this._dragTag = null;

    this.onAnnotatePlace = null;
    this.onTagMoved = null;

    this._bind();
  }

  _bind() {
    const vp = this.viewport;
    vp.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    vp.addEventListener("pointermove", (e) => this._onPointerMove(e));
    vp.addEventListener("pointerup", (e) => this._onPointerUp(e));
    vp.addEventListener("pointercancel", (e) => this._onPointerUp(e));
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

  setAnnotate(on) {
    this.annotate = !!on;
    this.viewport.classList.toggle("annotate", this.annotate);
    this.renderOverlay();
  }

  setShowAll(on) {
    this.showAll = !!on;
    this.renderOverlay();
  }

  async loadMap(map) {
    this.map = map;
    this.highlightId = null;
    const src = map.image;
    await new Promise((resolve, reject) => {
      this.imageEl.onload = () => resolve();
      this.imageEl.onerror = () => reject(new Error("Immagine mappa non caricata"));
      this.imageEl.src = src;
    });
    const w = map.width || this.imageEl.naturalWidth;
    const h = map.height || this.imageEl.naturalHeight;
    this.imageEl.width = w;
    this.imageEl.height = h;
    this.overlayEl.style.width = `${w}px`;
    this.overlayEl.style.height = `${h}px`;
    this.fit();
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

  highlight(tagId, { center = true } = {}) {
    this.highlightId = tagId || null;
    this.renderOverlay();
    if (center && tagId && this.map) {
      const tag = (this.map.tags || []).find((t) => t.id === tagId);
      if (tag) this.centerOnTag(tag);
    }
  }

  centerOnTag(tag) {
    const iw = this.imageEl.width;
    const ih = this.imageEl.height;
    const cxImg = (tag.x + tag.w / 2) * iw;
    const cyImg = (tag.y + tag.h / 2) * ih;
    const targetScale = Math.min(4, Math.max(this.scale, 1.6));
    this.scale = targetScale;
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    this.tx = vw / 2 - cxImg * targetScale;
    this.ty = vh / 2 - cyImg * targetScale;
    this.applyTransform();
  }

  renderOverlay() {
    const overlay = this.overlayEl;
    overlay.innerHTML = "";
    if (!this.map) return;
    const iw = this.imageEl.width;
    const ih = this.imageEl.height;
    for (const tag of this.map.tags || []) {
      const isHit = this.highlightId && tag.id === this.highlightId;
      if (!this.annotate && !this.showAll && !isHit) continue;
      const el = document.createElement("div");
      el.className = "tag-box";
      if (this.annotate) el.classList.add("edit");
      else if (isHit) el.classList.add("hit");
      else el.classList.add("dim");
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
    if (wasDrag) {
      this._dragTag = null;
      if (this.onTagMoved) this.onTagMoved(wasDrag.id);
    }

    const had = this._pointers.has(e.pointerId);
    this._pointers.delete(e.pointerId);
    if (this._pointers.size < 2) this._lastPinch = null;

    if (this._pointers.size === 0) {
      const clicked = this._panning && !this._moved && this.annotate && !wasDrag && had;
      this._panning = false;
      this.viewport.classList.remove("panning");
      if (clicked) {
        const rect = this.viewport.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const ix = (cx - this.tx) / this.scale / this.imageEl.width;
        const iy = (cy - this.ty) / this.scale / this.imageEl.height;
        if (ix >= 0 && iy >= 0 && ix <= 1 && iy <= 1 && this.onAnnotatePlace) {
          this.onAnnotatePlace(ix, iy);
        }
      }
      this._panStart = null;
      this._moved = false;
    }
  }
}
