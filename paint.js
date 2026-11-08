(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const sheetWrap = $('sheetWrap');
  const layerStack = $('layerStack');
  const preview = $('previewCanvas');
  const pctx = preview.getContext('2d');
  const overlay = $('overlayCanvas');
  const octx = overlay.getContext('2d');
  const brushCursor = document.createElement('div');
  brushCursor.className = 'brush-cursor';
  brushCursor.setAttribute('aria-hidden', 'true');
  stage.appendChild(brushCursor);
  const colorInput = $('colorInput');
  const brushSize = $('brushSize');
  const brushOpacity = $('brushOpacity');
  const brushHardness = $('brushHardness');
  const MAX_HISTORY = 18;
  const MAX_LAYERS = 100;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const rad = (d) => d * Math.PI / 180;
  const cloneCanvas = (source) => {
    const c = document.createElement('canvas');
    c.width = source.width; c.height = source.height;
    c.getContext('2d').drawImage(source, 0, 0);
    return c;
  };

  let docW = 1200, docH = 900;
  let layers = [];
  let activeId = null;
  let nextLayerId = 1;
  let tool = 'brush';
  let brush = 'pen';
  let zoom = 1, viewRotation = 0, panX = 0, panY = 0, fitScale = 1;
  let cursorPoint = null;
  let cursorCenterPreview = false;
  let drawing = false, activePointer = null, strokePoints = [], strokeBefore = null;
  let erasingPreview = false;
  let spaceDown = false, panning = false, panPointer = null, panStart = null;
  const pointers = new Map();
  let gesture = null, suppressTouchDrawing = false;
  let symmetryEnabled = false;
  let selectionRect = null, selectionDrag = null, floatingSelection = null, selectionClipboard = null;
  let recentColors = [];
  let pendingTextPoint = null;
  const RECENT_COLOR_LIMIT = 12;
  let history = [], redoHistory = [];
  let artworkChanged = false;
  let isDirty = false;
  let toastTimer = 0;
  let backgroundColor = '#ffffff';
  let foregroundColor = '#6757e8';

  const toolNames = { brush: 'Пензель', eraser: 'Гумка', eyedropper: 'Піпетка', fill: 'Заливка', line: 'Лінія', rect: 'Прямокутник', ellipse: 'Еліпс', select: 'Виділення', text: 'Текст' };
  const brushNames = { pen: 'Dip Pen', pencil: 'Pencil', marker: 'Marker', airbrush: 'Airbrush', watercolor: 'Watercolor', calligraphy: 'Calligraphy', pixel: 'Pixel', soft: 'Soft', chalk: 'Chalk', ink: 'Ink', flat: 'Flat', glow: 'Glow', crayon: 'Crayon', texture: 'Texture' };
  const colorNames = { '#171923':'Графіт', '#ffffff':'Білий', '#ef476f':'Рожевий', '#ff8c42':'Помаранчевий', '#ffd166':'Жовтий', '#06d6a0':'М’ятний', '#00b4d8':'Блакитний', '#4d96ff':'Синій', '#6757e8':'Фіолетовий', '#b565d9':'Лавандовий', '#c77d4a':'Коричневий', '#8d99ae':'Сірий' };

  function toast(message) {
    const el = $('toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function makeLayer(name, fill = null, isBackground = false) {
    const canvas = document.createElement('canvas'); canvas.width = docW; canvas.height = docH;
    const layer = { id: nextLayerId++, name, canvas, visible: true, opacity: 1, locked: false, blend: 'source-over', isBackground };
    if (fill) { const c = canvas.getContext('2d'); c.fillStyle = fill; c.fillRect(0, 0, docW, docH); }
    return layer;
  }
  function activeLayer() { return layers.find(l => l.id === activeId) || layers[layers.length - 1]; }
  function layerCtx(layer = activeLayer()) { return layer.canvas.getContext('2d', { willReadFrequently: true }); }
  function captureState(mode = 'none', targetId = null) {
    return {
      mode, targetId, docW, docH, activeId, nextLayerId, artworkChanged, isDirty,
      layers: layers.map(l => ({ id:l.id, name:l.name, visible:l.visible, opacity:l.opacity, locked:l.locked, blend:l.blend, isBackground:Boolean(l.isBackground), canvasRef:l.canvas,
        image: mode === 'all' || (mode === 'layer' && l.id === targetId) ? cloneCanvas(l.canvas) : null }))
    };
  }
  function historyLimit() { return clamp(Math.floor(20_000_000 / (docW * docH)), 1, MAX_HISTORY); }
  function record(mode = 'none', targetId = null) {
    history.push(captureState(mode, targetId));
    if (history.length > historyLimit()) history.shift();
    redoHistory = []; updateHistoryButtons();
  }
  function restoreState(state) {
    docW = state.docW; docH = state.docH; activeId = state.activeId; nextLayerId = state.nextLayerId; artworkChanged = Boolean(state.artworkChanged); isDirty = Boolean(state.isDirty);
    layers = state.layers.map(item => {
      const canvas = item.image || item.canvasRef;
      return { id:item.id, name:item.name, visible:item.visible, opacity:item.opacity, locked:item.locked, blend:item.blend, isBackground:Boolean(item.isBackground), canvas };
    });
    preview.width = docW; preview.height = docH; preview.style.width = `${docW}px`; preview.style.height = `${docH}px`;
    overlay.width = docW; overlay.height = docH; overlay.style.width = `${docW}px`; overlay.style.height = `${docH}px`;
    strokePoints = []; drawing = false; erasingPreview = false; selectionRect = null; selectionDrag = null; floatingSelection = null;
    $('docWidth').value = docW; $('docHeight').value = docH;
    renderLayers(); updateDimensions(); updateSheetTransform(); updateStatus('Зміни відновлено');
  }
  function undo() {
    if (!history.length) return;
    const previous = history.pop();
    const mode = previous.mode; const target = previous.targetId;
    redoHistory.push(captureState(mode, target)); restoreState(previous); updateHistoryButtons();
  }
  function redo() {
    if (!redoHistory.length) return;
    const next = redoHistory.pop();
    history.push(captureState(next.mode, next.targetId)); restoreState(next); updateHistoryButtons();
  }
  function updateHistoryButtons() { $('undoBtn').disabled = !history.length; $('redoBtn').disabled = !redoHistory.length; }
  function updateDimensions() {
    $('canvasDimensions').textContent = `${docW} × ${docH} px`;
    $('mobileCanvasSize').textContent = `${docW} × ${docH}`;
  }
  function updateStatus(message) {
    $('canvasStatus').textContent = message;
    $('documentStatus').textContent = isDirty ? 'Є незбережені зміни' : 'Збережено / нова робота';
    $('emptyHint').classList.toggle('hidden', artworkChanged);
    $('mobileToolName').textContent = toolNames[tool] || tool;
  }
  function hasPixels(canvas) {
    // Keep the status check cheap: a tiny sample grid is enough to detect non-empty artwork.
    const c = canvas.getContext('2d');
    const sample = document.createElement('canvas'); sample.width = 16; sample.height = 12;
    const s = sample.getContext('2d'); s.drawImage(canvas, 0, 0, 16, 12);
    const data = s.getImageData(0, 0, 16, 12).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
    return false;
  }

  function renderLayers() {
    layerStack.replaceChildren();
    layers.forEach((layer, index) => {
      layer.canvas.className = 'layer-canvas';
      layer.canvas.style.width = `${docW}px`; layer.canvas.style.height = `${docH}px`;
      layer.canvas.style.zIndex = String(index + 1);
      layer.canvas.style.display = layer.visible ? 'block' : 'none';
      layer.canvas.style.opacity = String(layer.opacity);
      layer.canvas.style.mixBlendMode = layer.blend === 'source-over' ? 'normal' : layer.blend;
      layerStack.appendChild(layer.canvas);
      if (layer.id === activeId) {
        preview.style.zIndex = String(index + 2);
        layerStack.appendChild(preview);
      }
    });
    if (!layers.some(l => l.id === activeId)) activeId = layers[layers.length - 1]?.id ?? null;
    renderLayerList();
    drawOverlay(); updateSelectionButtons();
    updateStatus('Полотно готове');
  }
  function renderLayerList() {
    const list = $('layerList'); list.replaceChildren();
    [...layers].reverse().forEach(layer => {
      const row = document.createElement('div'); row.className = `layer-row${layer.id === activeId ? ' active' : ''}`;
      const eye = document.createElement('button'); eye.className = 'layer-visibility'; eye.textContent = layer.visible ? '◉' : '◌'; eye.title = layer.visible ? 'Приховати шар' : 'Показати шар';
      eye.addEventListener('click', e => { e.stopPropagation(); record(); layer.visible = !layer.visible; isDirty = true; renderLayers(); });
      const thumb = document.createElement('canvas'); thumb.className = 'layer-thumb'; thumb.width = 84; thumb.height = 64; thumb.getContext('2d').drawImage(layer.canvas, 0, 0, 84, 64);
      const copy = document.createElement('div'); copy.className = 'layer-name';
      const name = document.createElement('b'); name.textContent = layer.name;
      const meta = document.createElement('small'); meta.textContent = `${Math.round(layer.opacity * 100)}%${layer.locked ? ' · 🔒' : ''}`;
      copy.append(name, meta);
      const lock = document.createElement('button'); lock.className = 'layer-lock'; lock.textContent = layer.locked ? '🔒' : '🔓'; lock.title = layer.locked ? 'Розблокувати' : 'Заблокувати';
      lock.addEventListener('click', e => { e.stopPropagation(); record(); layer.locked = !layer.locked; isDirty = true; renderLayerList(); updateStatus('Параметри шару змінено'); });
      row.append(eye, thumb, copy, lock); row.addEventListener('click', () => selectLayer(layer.id)); list.appendChild(row);
    });
    const current = activeLayer();
    $('layerOpacity').value = current ? Math.round(current.opacity * 100) : 100;
    $('layerOpacityOut').textContent = `${$('layerOpacity').value}%`;
    $('deleteLayerBtn').disabled = layers.length <= 1;
    $('layerDownBtn').disabled = !current || layers[0]?.id === current.id;
    $('layerUpBtn').disabled = !current || layers[layers.length - 1]?.id === current.id;
  }
  function selectLayer(id) { activeId = id; renderLayers(); }
  function addLayer(name = `Шар ${layers.length + 1}`, source = null) {
    if (layers.length >= MAX_LAYERS) return toast(`Максимум ${MAX_LAYERS} шарів`);
    record(); const layer = makeLayer(name);
    if (source) layerCtx(layer).drawImage(source, 0, 0, docW, docH);
    const idx = layers.findIndex(l => l.id === activeId);
    layers.splice(idx + 1, 0, layer); activeId = layer.id; isDirty = true; renderLayers(); toast('Новий шар створено');
  }
  function duplicateLayer() {
    const current = activeLayer(); if (!current || layers.length >= MAX_LAYERS) return;
    record(); const copy = makeLayer(`${current.name} копія`); layerCtx(copy).drawImage(current.canvas, 0, 0);
    const idx = layers.findIndex(l => l.id === current.id); layers.splice(idx + 1, 0, copy); activeId = copy.id; isDirty = true; artworkChanged = true; renderLayers(); toast('Шар дубльовано');
  }
  function deleteLayer() {
    if (layers.length <= 1) return toast('Потрібен хоча б один шар');
    record(); const idx = layers.findIndex(l => l.id === activeId); layers.splice(idx, 1); activeId = layers[Math.max(0, idx - 1)].id; isDirty = true; renderLayers(); toast('Шар видалено');
  }
  function moveLayer(direction) {
    const idx = layers.findIndex(l => l.id === activeId); const next = idx + direction;
    if (idx < 0 || next < 0 || next >= layers.length) return;
    record(); [layers[idx], layers[next]] = [layers[next], layers[idx]]; isDirty = true; renderLayers();
  }
  function renameLayer() {
    const layer = activeLayer(); if (!layer) return;
    const name = prompt('Нова назва шару:', layer.name);
    if (name && name.trim()) { record(); layer.name = name.trim().slice(0, 40); isDirty = true; renderLayerList(); updateStatus('Шар перейменовано'); }
  }

  function updateSheetTransform() {
    const sw = Math.max(1, stage.clientWidth), sh = Math.max(1, stage.clientHeight);
    const a = rad(viewRotation), cw = Math.abs(Math.cos(a)) * docW + Math.abs(Math.sin(a)) * docH;
    const ch = Math.abs(Math.sin(a)) * docW + Math.abs(Math.cos(a)) * docH;
    fitScale = Math.min((sw - 54) / cw, (sh - 54) / ch);
    fitScale = clamp(fitScale, 0.015, 8);
    const scale = fitScale * zoom;
    sheetWrap.style.width = `${docW}px`; sheetWrap.style.height = `${docH}px`;
    sheetWrap.style.transform = `translate(-50%,-50%) translate(${panX}px,${panY}px) rotate(${viewRotation}deg) scale(${scale})`;
    $('zoomLabel').textContent = `${Math.round(zoom * 100)}%`; $('mobileZoom').textContent = `${Math.round(zoom * 100)}%`;
    renderBrushCursor();
  }
  function stagePoint(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    return { x: clientX - rect.left - stage.clientLeft, y: clientY - rect.top - stage.clientTop };
  }
  function brushVisualWidth() {
    const size = Number(brushSize.value);
    if (tool === 'eraser') return size;
    const multipliers = {
      pen: 1,
      pencil: .78,
      marker: 1.8,
      airbrush: 1.44,
      watercolor: 1.5,
      calligraphy: .38,
      pixel: Math.max(2, size * .6) / size,
      soft: 1.25
    };
    return size * (multipliers[brush] || 1);
  }
  function renderBrushCursor() {
    if (!brushCursor) return;
    if (tool === 'eyedropper' || tool === 'fill') {
      brushCursor.style.opacity = '0';
      return;
    }
    let point = cursorPoint;
    if (cursorCenterPreview) {
      point = {
        x: stage.clientWidth / 2 + panX,
        y: stage.clientHeight / 2 + panY
      };
    }
    if (!point) {
      brushCursor.style.opacity = '0';
      return;
    }
    const diameter = Math.max(2, brushVisualWidth() * fitScale * zoom);
    brushCursor.style.left = `${point.x}px`;
    brushCursor.style.top = `${point.y}px`;
    brushCursor.style.width = `${diameter}px`;
    brushCursor.style.height = `${diameter}px`;
    brushCursor.style.opacity = '1';
    brushCursor.title = `${Math.round(brushVisualWidth() * 10) / 10} px`;
    brushCursor.classList.toggle('is-eraser', tool === 'eraser');
    brushCursor.classList.toggle('is-pixel', brush === 'pixel' && tool !== 'eraser');
  }
  function trackBrushCursor(event) {
    if (event.target.closest('.stage-tools')) {
      cursorPoint = null;
      cursorCenterPreview = false;
      renderBrushCursor();
      return;
    }
    const point = stagePoint(event.clientX, event.clientY);
    const docPoint = screenToDoc(event.clientX, event.clientY);
    if (docPoint.x < 0 || docPoint.y < 0 || docPoint.x > docW || docPoint.y > docH) {
      cursorPoint = null;
      cursorCenterPreview = false;
      renderBrushCursor();
      return;
    }
    cursorPoint = point;
    cursorCenterPreview = false;
    renderBrushCursor();
  }
  function showBrushCursorAtCanvasCenter() {
    cursorPoint = null;
    cursorCenterPreview = true;
    renderBrushCursor();
  }
  function hideBrushCursor() {
    cursorPoint = null;
    cursorCenterPreview = false;
    renderBrushCursor();
  }
  function screenToDoc(clientX, clientY) {
    const p = stagePoint(clientX, clientY); const scale = fitScale * zoom;
    const dx = p.x - stage.clientWidth / 2 - panX, dy = p.y - stage.clientHeight / 2 - panY;
    const a = rad(-viewRotation), x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a);
    return { x: x / scale + docW / 2, y: y / scale + docH / 2 };
  }
  function zoomAt(nextZoom, clientX, clientY) {
    const p = stagePoint(clientX, clientY); const before = screenToDoc(clientX, clientY);
    zoom = clamp(nextZoom, 0.15, 8); const scale = fitScale * zoom;
    const relX = (before.x - docW / 2) * scale, relY = (before.y - docH / 2) * scale;
    const a = rad(viewRotation); const rx = relX * Math.cos(a) - relY * Math.sin(a), ry = relX * Math.sin(a) + relY * Math.cos(a);
    panX = p.x - stage.clientWidth / 2 - rx; panY = p.y - stage.clientHeight / 2 - ry;
    updateSheetTransform();
  }
  function resetView() { zoom = 1; viewRotation = 0; panX = 0; panY = 0; updateSheetTransform(); }
  function fitView() { zoom = 1; panX = 0; panY = 0; updateSheetTransform(); }

  function setTool(next) {
    tool = next;
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === next));
    $('mobileToolName').textContent = toolNames[next] || next;
    $('canvasStatus').textContent = `${toolNames[next] || next} активний`;
    if (next === 'select') openPanel('canvasPanel');
    else if (next === 'text') openPanel('brushPanel');
    renderBrushCursor();
  }
  function setBrush(next) {
    brush = next; document.querySelectorAll('[data-brush]').forEach(b => b.classList.toggle('selected', b.dataset.brush === next));
    $('brushReadout').textContent = `${brushNames[next]} · ${brushSize.value} px`;
    renderBrushCursor();
  }
  function loadRecentColors() {
    try {
      const stored = JSON.parse(localStorage.getItem('pxlStudio.recentColors') || '[]');
      recentColors = Array.isArray(stored) ? stored.filter(v => /^#[0-9a-f]{6}$/i.test(v)).slice(0, RECENT_COLOR_LIMIT) : [];
    } catch (_) { recentColors = []; }
    renderRecentColors();
  }
  function rememberColor(value) {
    const normalized = String(value).toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(normalized)) return;
    recentColors = [normalized, ...recentColors.filter(c => c !== normalized)].slice(0, RECENT_COLOR_LIMIT);
    try { localStorage.setItem('pxlStudio.recentColors', JSON.stringify(recentColors)); } catch (_) {}
    renderRecentColors();
  }
  function renderRecentColors() {
    const box = $('recentSwatches'); if (!box) return;
    box.replaceChildren();
    $('recentColorsWrap').classList.toggle('hidden', recentColors.length === 0);
    recentColors.forEach(color => {
      const button = document.createElement('button');
      button.type = 'button'; button.style.setProperty('--sw', color); button.dataset.recentColor = color;
      button.title = color.toUpperCase(); button.setAttribute('aria-label', `Колір ${color}`);
      button.addEventListener('click', () => setColor(color));
      box.appendChild(button);
    });
  }
  function setColor(value) {
    foregroundColor = value.toLowerCase(); colorInput.value = foregroundColor;
    $('colorHex').textContent = foregroundColor.toUpperCase(); $('colorName').textContent = colorNames[foregroundColor] || 'Власний колір';
    document.querySelector('.color-picker span').style.background = foregroundColor;
    document.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('selected', b.dataset.color.toLowerCase() === foregroundColor));
    rememberColor(foregroundColor);
  }
  function setRange(input, output, suffix) {
    const v = Number(input.value); output.textContent = `${v}${suffix}`;
    input.style.setProperty('--progress', `${(v - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
  }
  function updateBrushControls(showSizePreview = false) {
    setRange(brushSize, $('brushSizeOut'), ' px'); setRange(brushOpacity, $('brushOpacityOut'), '%'); setRange(brushHardness, $('brushHardnessOut'), '%');
    $('brushSizeOut2').textContent = `${brushSize.value} px`; $('brushSizeColor').value = brushSize.value;
    $('brushReadout').textContent = `${brushNames[brush]} · ${brushSize.value} px`;
    if (showSizePreview && !drawing) showBrushCursorAtCanvasCenter();
    else renderBrushCursor();
  }
  function brushOpacityFactor() {
    if (brush === 'pencil') return .72;
    if (brush === 'marker') return .36;
    if (brush === 'watercolor') return .28;
    if (brush === 'soft') return .52;
    return 1;
  }
  function updatePreviewOpacity() {
    const factor = (tool === 'line' || tool === 'rect' || tool === 'ellipse') ? 1 : brushOpacityFactor();
    preview.style.opacity = tool === 'eraser' ? '1' : String((Number(brushOpacity.value) / 100) * factor);
  }
  function drawSegmentSingle(from, to) {
    const size = Number(brushSize.value), color = foregroundColor;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const pressure = clamp(((from.pressure || .5) + (to.pressure || .5)) / 2, .15, 1);
    let width = size, cap = 'round';
    if (brush === 'pencil') width = Math.max(.7, size * .78 * pressure);
    if (brush === 'marker') width = size * 1.8;
    if (brush === 'watercolor') width = size * 1.5;
    if (brush === 'soft') width = size * 1.25;
    if (brush === 'calligraphy') { width = Math.max(1, size * .38 * pressure); cap = 'butt'; }
    if (brush === 'ink') width = Math.max(1, size * (.45 + pressure * .75));
    if (brush === 'flat') { width = size * 1.15; cap = 'square'; }
    if (brush === 'pixel') {
      const step = Math.max(2, size * .6), count = Math.max(1, Math.ceil(distance / step));
      pctx.save(); pctx.fillStyle = color; pctx.globalAlpha = 1;
      for (let i = 0; i <= count; i++) { const t = i / count, x = from.x + (to.x-from.x)*t, y = from.y + (to.y-from.y)*t; pctx.fillRect(Math.round(x/step)*step, Math.round(y/step)*step, step, step); }
      pctx.restore(); updatePreviewOpacity(); return;
    }
    if (brush === 'chalk' || brush === 'crayon' || brush === 'texture') {
      const step = Math.max(2, size * (brush === 'texture' ? .22 : .16));
      const count = Math.max(1, Math.ceil(distance / step));
      const dots = brush === 'crayon' ? 22 : brush === 'chalk' ? 30 : 16;
      pctx.save(); pctx.fillStyle = color;
      for (let i = 0; i <= count; i++) {
        const t = i / count, cx = from.x + (to.x - from.x) * t, cy = from.y + (to.y - from.y) * t;
        for (let j = 0; j < dots; j++) {
          const seed = Math.floor(cx * 13 + cy * 17 + i * 41 + j * 67);
          const angle = deterministicNoise(seed) * Math.PI * 2;
          const radius = Math.sqrt(deterministicNoise(seed + 11)) * size * (brush === 'texture' ? .55 : .7);
          const dot = Math.max(.45, size * (.025 + deterministicNoise(seed + 29) * .055));
          pctx.globalAlpha = brush === 'chalk' ? .28 : brush === 'crayon' ? .34 : .22;
          pctx.beginPath(); pctx.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, dot, 0, Math.PI * 2); pctx.fill();
        }
      }
      pctx.restore(); updatePreviewOpacity(); return;
    }
    if (brush === 'airbrush') {
      const step = Math.max(2, size * .16), count = Math.max(1, Math.ceil(distance / step));
      const dots = clamp(Math.round(size * .24), 8, 26);
      pctx.save(); pctx.fillStyle = color;
      for (let i = 0; i <= count; i++) {
        const t = i / count, cx = from.x + (to.x-from.x)*t, cy = from.y + (to.y-from.y)*t;
        for (let j = 0; j < dots; j++) {
          const seed = (Math.round(cx*7) + Math.round(cy*11) + i*31 + j*17);
          const angle = deterministicNoise(seed) * Math.PI * 2;
          const radius = Math.sqrt(deterministicNoise(seed + 19)) * size * .72;
          const r = Math.max(.35, size * (.012 + deterministicNoise(seed + 37) * .028));
          pctx.globalAlpha = .11; pctx.beginPath(); pctx.arc(cx + Math.cos(angle)*radius, cy + Math.sin(angle)*radius, r, 0, Math.PI*2); pctx.fill();
        }
      }
      pctx.restore(); updatePreviewOpacity(); return;
    }
    pctx.save(); pctx.globalAlpha = 1; pctx.strokeStyle = color; pctx.fillStyle = color;
    pctx.lineWidth = width; pctx.lineCap = cap; pctx.lineJoin = 'round';
    if (brush === 'watercolor') { pctx.shadowColor = color; pctx.shadowBlur = size * (.25 + (1 - Number(brushHardness.value)/100) * .8); }
    if (brush === 'soft') { pctx.shadowColor = color; pctx.shadowBlur = size * (.15 + (1 - Number(brushHardness.value)/100) * 1.1); }
    if (brush === 'glow') { pctx.shadowColor = color; pctx.shadowBlur = size * 1.7; }
    pctx.beginPath(); pctx.moveTo(from.x, from.y); pctx.lineTo(to.x, to.y); pctx.stroke();
    if (brush === 'pencil') { pctx.shadowBlur = 0; pctx.lineWidth = Math.max(.5, width * .22); pctx.globalAlpha = .55; pctx.beginPath(); pctx.moveTo(from.x + .4, from.y - .35); pctx.lineTo(to.x + .4, to.y - .35); pctx.stroke(); }
    pctx.restore(); updatePreviewOpacity();
  }
  function drawSegment(from, to) {
    drawSegmentSingle(from, to);
    if (symmetryEnabled && Math.abs(from.x - docW / 2) > 0.001 && Math.abs(to.x - docW / 2) > 0.001) {
      drawSegmentSingle({ x: docW - from.x, y: from.y, pressure: from.pressure }, { x: docW - to.x, y: to.y, pressure: to.pressure });
    }
  }
  function deterministicNoise(seed) { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function renderShapePreview() {
    pctx.clearRect(0, 0, docW, docH);
    if (strokePoints.length < 2) return;
    const first = strokePoints[0], last = strokePoints[strokePoints.length - 1];
    const drawShape = (mirror = false) => {
      pctx.save();
      if (mirror) { pctx.translate(docW, 0); pctx.scale(-1, 1); }
      pctx.strokeStyle = foregroundColor; pctx.globalAlpha = 1; pctx.lineWidth = Number(brushSize.value); pctx.lineCap = 'round'; pctx.lineJoin = 'round'; pctx.beginPath();
      if (tool === 'line') { pctx.moveTo(first.x, first.y); pctx.lineTo(last.x, last.y); }
      else if (tool === 'rect') pctx.rect(first.x, first.y, last.x-first.x, last.y-first.y);
      else { const cx=(first.x+last.x)/2, cy=(first.y+last.y)/2; pctx.ellipse(cx,cy,Math.max(1,Math.abs(last.x-first.x)/2),Math.max(1,Math.abs(last.y-first.y)/2),0,0,Math.PI*2); }
      pctx.stroke(); pctx.restore();
    };
    drawShape(false); if (symmetryEnabled) drawShape(true); updatePreviewOpacity();
  }
  function erasePoint(point, mirror = false) {
    pctx.save(); if (mirror) { pctx.translate(docW, 0); pctx.scale(-1, 1); }
    pctx.globalCompositeOperation='destination-out'; pctx.globalAlpha=Number(brushOpacity.value)/100; pctx.fillStyle='#000';
    pctx.beginPath(); pctx.arc(point.x,point.y,Number(brushSize.value)/2,0,Math.PI*2); pctx.fill(); pctx.restore();
  }
  function eraseSegment(from, to, mirror = false) {
    pctx.save(); if (mirror) { pctx.translate(docW, 0); pctx.scale(-1, 1); }
    pctx.globalCompositeOperation='destination-out'; pctx.globalAlpha=Number(brushOpacity.value)/100; pctx.strokeStyle='#000'; pctx.lineWidth=Number(brushSize.value); pctx.lineCap='round'; pctx.lineJoin='round';
    pctx.beginPath(); pctx.moveTo(from.x,from.y); pctx.lineTo(to.x,to.y); pctx.stroke(); pctx.restore();
  }
  function startStroke(event) {
    const point = screenToDoc(event.clientX, event.clientY);
    if (point.x < 0 || point.y < 0 || point.x > docW || point.y > docH) return;
    if (tool === 'select') { startSelectionAction(event); return; }
    if (tool === 'text') { openTextDialog(point); return; }
    const layer = activeLayer(); if (!layer || layer.locked || !layer.visible) { toast('Активний шар заблокований або прихований'); return; }
    if (tool === 'eyedropper') { pickColor(point); return; }
    if (tool === 'fill') { floodFill(point); return; }
    drawing = true; activePointer = event.pointerId; strokePoints = [{ ...point, pressure: event.pressure || .5 }];
    strokeBefore = captureState('layer', layer.id); history.push(strokeBefore); if (history.length > historyLimit()) history.shift(); redoHistory = []; updateHistoryButtons();
    erasingPreview = tool === 'eraser';
    pctx.setTransform(1,0,0,1,0,0); pctx.clearRect(0,0,docW,docH); preview.style.opacity = '1';
    if (erasingPreview) { pctx.drawImage(layer.canvas,0,0); layer.canvas.style.visibility = 'hidden'; erasePoint(point); if (symmetryEnabled && Math.abs(point.x-docW/2)>.5) erasePoint({x:docW-point.x,y:point.y}); }
    else if (tool === 'line' || tool === 'rect' || tool === 'ellipse') updatePreviewOpacity();
    else drawSegment(point,point);
    try { stage.setPointerCapture(event.pointerId); } catch (_) {}
  }
  function moveStroke(event) {
    if (!drawing || event.pointerId !== activePointer) return;
    const point = screenToDoc(event.clientX, event.clientY);
    if (point.x < -4 || point.y < -4 || point.x > docW + 4 || point.y > docH + 4) return;
    const prev = strokePoints[strokePoints.length - 1];
    if (Math.hypot(point.x - prev.x, point.y - prev.y) < .35) return;
    const next = { ...point, pressure: event.pressure || .5 };
    strokePoints.push(next);
    if (tool === 'eraser') {
      eraseSegment(prev, next); if (symmetryEnabled && (Math.abs(prev.x-docW/2)>.5 || Math.abs(next.x-docW/2)>.5)) eraseSegment({x:docW-prev.x,y:prev.y},{x:docW-next.x,y:next.y});
    } else if (tool === 'line' || tool === 'rect' || tool === 'ellipse') renderShapePreview();
    else drawSegment(prev,next);
    $('canvasStatus').textContent = tool === 'eraser' ? 'Стираю…' : 'Малюю…';
  }
  function finishStroke(commit = true) {
    if (!drawing) return;
    const layer = activeLayer();
    if (commit && layer) {
      if (tool === 'eraser') {
        const c = layerCtx(layer); c.clearRect(0, 0, docW, docH); c.drawImage(preview, 0, 0); layer.canvas.style.visibility = 'visible';
      } else if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
        if (strokePoints.length > 1) { const c=layerCtx(layer); c.save(); c.globalAlpha=Number(brushOpacity.value)/100; c.drawImage(preview,0,0); c.restore(); }
      } else {
        const c=layerCtx(layer); c.save(); c.globalAlpha=(Number(brushOpacity.value)/100)*brushOpacityFactor(); c.drawImage(preview,0,0); c.restore();
      }
      artworkChanged = true; isDirty = true;
    } else {
      if (layer) layer.canvas.style.visibility = 'visible';
      if (history[history.length - 1] === strokeBefore) history.pop();
    }
    pctx.clearRect(0, 0, docW, docH); preview.style.opacity='1'; drawing = false; activePointer = null; strokePoints = []; strokeBefore = null; erasingPreview = false;
    renderLayers(); updateHistoryButtons(); if (commit) updateStatus('Малюнок оновлено');
  }

  function openTextDialog(point) {
    pendingTextPoint = point;
    $('textContent').value = '';
    $('textDialog').showModal();
    $('textContent').focus();
  }
  function insertTextAt(point, value) {
    const layer = activeLayer();
    if (!layer || layer.locked || !layer.visible) return toast('Активний шар заблокований або прихований');
    if (!value || !value.trim()) return toast('Введи текст перед додаванням');
    record('layer', layer.id);
    const ctx = layerCtx(layer), size = Number($('textSize').value) || 48;
    const font = $('textFont').value.trim() || 'Arial';
    ctx.save(); ctx.fillStyle = foregroundColor; ctx.textBaseline = 'top';
    ctx.font = `${$('textBold').checked ? '700 ' : ''}${size}px ${font}`;
    const lineHeight = size * 1.25;
    value.slice(0, 2000).split('\n').slice(0, 50).forEach((line, index) => ctx.fillText(line.slice(0, 300), point.x, point.y + index * lineHeight, Math.max(1, docW - point.x)));
    ctx.restore(); artworkChanged = true; isDirty = true; renderLayers(); updateStatus('Текст додано'); toast('Текст додано до активного шару');
  }
  function normalizedRect(a, b) {
    const x = clamp(Math.floor(Math.min(a.x,b.x)),0,docW), y = clamp(Math.floor(Math.min(a.y,b.y)),0,docH);
    const right = clamp(Math.ceil(Math.max(a.x,b.x)),0,docW), bottom = clamp(Math.ceil(Math.max(a.y,b.y)),0,docH);
    return {x,y,width:Math.max(1,right-x),height:Math.max(1,bottom-y)};
  }
  function pointInRect(point, rect) { return Boolean(rect && point.x>=rect.x && point.y>=rect.y && point.x<=rect.x+rect.width && point.y<=rect.y+rect.height); }
  function drawOverlay() {
    if (!overlay) return;
    if (overlay.width !== docW || overlay.height !== docH) { overlay.width=docW; overlay.height=docH; overlay.style.width=`${docW}px`; overlay.style.height=`${docH}px`; }
    octx.clearRect(0,0,docW,docH);
    if (floatingSelection) octx.drawImage(floatingSelection.canvas, floatingSelection.x, floatingSelection.y);
    if (symmetryEnabled) {
      octx.save(); octx.strokeStyle='rgba(255,218,98,.95)'; octx.lineWidth=Math.max(1,docW/1200); octx.setLineDash([14,10]);
      octx.beginPath(); octx.moveTo(docW/2,0); octx.lineTo(docW/2,docH); octx.stroke();
      octx.fillStyle='rgba(255,218,98,.95)'; octx.font=`${Math.max(14,docW/90)}px Arial`; octx.fillText('SYMMETRY',docW/2+8,Math.max(22,docH/35)); octx.restore();
    }
    const rect = selectionDrag?.mode === 'new' ? normalizedRect(selectionDrag.start, selectionDrag.current) : selectionRect;
    if (rect) {
      octx.save(); octx.lineWidth=Math.max(1,docW/1000); octx.setLineDash([8,5]); octx.strokeStyle='#171923'; octx.strokeRect(rect.x,rect.y,rect.width,rect.height);
      octx.lineDashOffset=6; octx.strokeStyle='#fff'; octx.strokeRect(rect.x,rect.y,rect.width,rect.height); octx.restore();
    }
  }
  function updateSelectionButtons() {
    const hasRect = Boolean(selectionRect), hasFloat = Boolean(floatingSelection), hasClipboard = Boolean(selectionClipboard);
    $('copySelectionBtn').disabled = !hasRect;
    $('cutSelectionBtn').disabled = !hasRect;
    $('deleteSelectionBtn').disabled = !hasRect;
    $('pasteSelectionBtn').disabled = !hasClipboard || hasFloat;
    $('clearSelectionBtn').disabled = !hasRect && !hasFloat && !selectionDrag;
  }
  function startSelectionAction(event) {
    try { stage.setPointerCapture(event.pointerId); } catch (_) {}
    const point = screenToDoc(event.clientX,event.clientY);
    if (point.x<0 || point.y<0 || point.x>docW || point.y>docH) return;
    const layer = activeLayer(); if (!layer || layer.locked || !layer.visible) return toast('Активний шар заблокований або прихований');
    if (floatingSelection && pointInRect(point,{x:floatingSelection.x,y:floatingSelection.y,width:floatingSelection.canvas.width,height:floatingSelection.canvas.height})) {
      selectionDrag={mode:'move-float',pointerId:event.pointerId,offsetX:point.x-floatingSelection.x,offsetY:point.y-floatingSelection.y};
      return;
    }
    if (selectionRect && pointInRect(point,selectionRect)) {
      record('layer',layer.id);
      const rect=selectionRect, part=document.createElement('canvas'); part.width=rect.width; part.height=rect.height;
      part.getContext('2d').drawImage(layer.canvas,rect.x,rect.y,rect.width,rect.height,0,0,rect.width,rect.height);
      layerCtx(layer).clearRect(rect.x,rect.y,rect.width,rect.height);
      floatingSelection={canvas:part,x:rect.x,y:rect.y}; selectionRect=null;
      selectionDrag={mode:'move-float',pointerId:event.pointerId,offsetX:point.x-floatingSelection.x,offsetY:point.y-floatingSelection.y,recorded:true};
      renderLayers(); drawOverlay(); return;
    }
    selectionDrag={mode:'new',pointerId:event.pointerId,start:point,current:point};
    drawOverlay();
  }
  function moveSelectionAction(event) {
    if (!selectionDrag || selectionDrag.pointerId!==event.pointerId) return false;
    const point=screenToDoc(event.clientX,event.clientY);
    if (selectionDrag.mode==='new') selectionDrag.current=point;
    else if (floatingSelection) { floatingSelection.x=clamp(point.x-selectionDrag.offsetX,0,docW-floatingSelection.canvas.width); floatingSelection.y=clamp(point.y-selectionDrag.offsetY,0,docH-floatingSelection.canvas.height); }
    drawOverlay(); return true;
  }
  function finishSelectionAction(event, cancelled=false) {
    if (!selectionDrag || selectionDrag.pointerId!==event.pointerId) return false;
    const drag=selectionDrag; selectionDrag=null;
    if (drag.mode==='new') {
      const rect=normalizedRect(drag.start,drag.current);
      selectionRect=(rect.width>2 && rect.height>2)?rect:null;
    } else if (floatingSelection) {
      const layer=activeLayer();
      if (layer) { layerCtx(layer).drawImage(floatingSelection.canvas,floatingSelection.x,floatingSelection.y); selectionRect={x:floatingSelection.x,y:floatingSelection.y,width:floatingSelection.canvas.width,height:floatingSelection.canvas.height}; artworkChanged=true; isDirty=true; renderLayers(); }
      floatingSelection=null;
    }
    drawOverlay(); updateSelectionButtons();
    if (!cancelled && drag.mode==='new' && selectionRect) toast('Область виділено');
    return true;
  }
  function copySelection() {
    if (!selectionRect) return;
    const layer=activeLayer(); if (!layer) return;
    const r=selectionRect, copy=document.createElement('canvas'); copy.width=r.width; copy.height=r.height;
    copy.getContext('2d').drawImage(layer.canvas,r.x,r.y,r.width,r.height,0,0,r.width,r.height);
    selectionClipboard=copy; updateSelectionButtons(); toast('Виділення скопійовано');
  }
  function cutSelection() {
    if (!selectionRect) return;
    const layer=activeLayer(); if (!layer || layer.locked) return;
    copySelection(); record('layer',layer.id); layerCtx(layer).clearRect(selectionRect.x,selectionRect.y,selectionRect.width,selectionRect.height);
    artworkChanged=true; isDirty=true; renderLayers(); drawOverlay(); toast('Виділення вирізано');
  }
  function pasteSelection() {
    if (!selectionClipboard || floatingSelection) return;
    const layer=activeLayer(); if (!layer || layer.locked) return toast('Активний шар заблокований');
    const x=Math.round((docW-selectionClipboard.width)/2), y=Math.round((docH-selectionClipboard.height)/2);
    record('layer',layer.id); layerCtx(layer).drawImage(selectionClipboard,x,y);
    selectionRect={x,y,width:selectionClipboard.width,height:selectionClipboard.height};
    artworkChanged=true; isDirty=true; setTool('select'); openPanel('canvasPanel'); renderLayers(); drawOverlay(); updateSelectionButtons(); toast('Фрагмент вставлено — перетягни рамку, щоб перемістити');
  }
  function deleteSelection() {
    if (!selectionRect) return;
    const layer=activeLayer(); if (!layer || layer.locked) return;
    record('layer',layer.id); layerCtx(layer).clearRect(selectionRect.x,selectionRect.y,selectionRect.width,selectionRect.height);
    selectionRect=null; artworkChanged=true; isDirty=true; renderLayers(); drawOverlay(); updateSelectionButtons(); toast('Виділену область видалено');
  }
  function clearSelection() {
    if (floatingSelection) {
      const layer=activeLayer(); if (layer) { layerCtx(layer).drawImage(floatingSelection.canvas,floatingSelection.x,floatingSelection.y); artworkChanged=true; isDirty=true; renderLayers(); }
      floatingSelection=null;
    }
    selectionRect=null; selectionDrag=null; drawOverlay(); updateSelectionButtons();
  }

  function floodFill(point) {
    const layer = activeLayer(); if (!layer || layer.locked) return toast('Шар заблокований');
    const x0 = clamp(Math.floor(point.x), 0, docW - 1), y0 = clamp(Math.floor(point.y), 0, docH - 1);
    const c = layerCtx(layer), image = c.getImageData(0, 0, docW, docH), data = image.data;
    const start = (y0 * docW + x0) * 4, target = [data[start],data[start+1],data[start+2],data[start+3]];
    const rgb = hex => [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
    const replacement = rgb(foregroundColor); replacement.push(255);
    if (target[0] === replacement[0] && target[1] === replacement[1] && target[2] === replacement[2] && target[3] === 255) return;
    record('layer', layer.id);
    const tolerance = 22, match = idx => Math.abs(data[idx]-target[0]) <= tolerance && Math.abs(data[idx+1]-target[1]) <= tolerance && Math.abs(data[idx+2]-target[2]) <= tolerance && Math.abs(data[idx+3]-target[3]) <= tolerance;
    const stack = [x0, y0]; let processed = 0;
    while (stack.length && processed < docW * docH * 2) {
      const y = stack.pop(), x = stack.pop(); if (x < 0 || y < 0 || x >= docW || y >= docH) continue;
      let px = x, idx = (y * docW + px) * 4;
      while (px >= 0 && match(idx)) { px--; idx -= 4; }
      px++; idx += 4; let spanUp = false, spanDown = false;
      while (px < docW && match(idx)) {
        data[idx] = replacement[0]; data[idx+1] = replacement[1]; data[idx+2] = replacement[2]; data[idx+3] = replacement[3]; processed++;
        if (y > 0) { const up = idx - docW * 4; if (match(up) && !spanUp) { stack.push(px,y-1); spanUp = true; } else if (!match(up)) spanUp = false; }
        if (y < docH - 1) { const down = idx + docW * 4; if (match(down) && !spanDown) { stack.push(px,y+1); spanDown = true; } else if (!match(down)) spanDown = false; }
        px++; idx += 4;
      }
    }
    c.putImageData(image, 0, 0); artworkChanged = true; isDirty = true; renderLayers(); updateStatus('Заливку застосовано');
  }
  function compositeDocument() {
    const out = document.createElement('canvas'); out.width = docW; out.height = docH; const c = out.getContext('2d');
    layers.forEach(l => { if (!l.visible) return; c.save(); c.globalAlpha = l.opacity; c.globalCompositeOperation = l.blend || 'source-over'; c.drawImage(l.canvas,0,0); c.restore(); });
    return out;
  }
  function pickColor(point) {
    const merged = compositeDocument(), x = clamp(Math.floor(point.x),0,docW-1), y = clamp(Math.floor(point.y),0,docH-1);
    const data = merged.getContext('2d').getImageData(x,y,1,1).data;
    const hex = '#' + [...data].slice(0,3).map(n => n.toString(16).padStart(2,'0')).join(''); setColor(hex); setTool('brush'); toast(`Колір ${hex.toUpperCase()}`);
  }

  function setCanvasSize(width, height, scaleArtwork = false) {
    width = Math.round(clamp(Number(width) || 0, 64, 4096)); height = Math.round(clamp(Number(height) || 0, 64, 4096));
    if (width === docW && height === docH) return;
    record('all'); const oldW = docW, oldH = docH; docW = width; docH = height;
    layers.forEach(layer => {
      const old = layer.canvas, next = document.createElement('canvas');
      next.width = docW;
      next.height = docH;
      const c = next.getContext('2d');

      // The bottom background layer must cover the whole new document.
      // Previously only the old bitmap was centered, so enlarging the canvas
      // left transparent strips around the original white area.
      if (layer.isBackground) {
        const oldCtx = old.getContext('2d', { willReadFrequently: true });
        const corner = oldCtx.getImageData(0, 0, 1, 1).data;
        c.fillStyle = corner[3] > 0
          ? `rgba(${corner[0]}, ${corner[1]}, ${corner[2]}, ${corner[3] / 255})`
          : '#ffffff';
        c.fillRect(0, 0, docW, docH);
      }

      if (scaleArtwork) c.drawImage(old, 0, 0, oldW, oldH, 0, 0, docW, docH);
      else c.drawImage(old, (docW-oldW)/2, (docH-oldH)/2);
      layer.canvas = next;
    });
    preview.width = docW; preview.height = docH; preview.style.width = `${docW}px`; preview.style.height = `${docH}px`;
    overlay.width = docW; overlay.height = docH; overlay.style.width = `${docW}px`; overlay.style.height = `${docH}px`;
    $('docWidth').value = docW; $('docHeight').value = docH; artworkChanged = true; isDirty = true; renderLayers(); updateDimensions(); resetView(); toast(`Полотно: ${docW} × ${docH}`);
  }
  function transformDocument(kind) {
    record('all');
    layers.forEach(layer => {
      const old = layer.canvas, next = document.createElement('canvas');
      if (kind === 'rotateLeft' || kind === 'rotateRight') { next.width = docH; next.height = docW; const c = next.getContext('2d'); if (kind === 'rotateRight') { c.translate(docH,0); c.rotate(Math.PI/2); } else { c.translate(0,docW); c.rotate(-Math.PI/2); } c.drawImage(old,0,0); }
      else { next.width = docW; next.height = docH; const c = next.getContext('2d'); if (kind === 'flipH') { c.translate(docW,0); c.scale(-1,1); } else { c.translate(0,docH); c.scale(1,-1); } c.drawImage(old,0,0); }
      layer.canvas = next;
    });
    if (kind === 'rotateLeft' || kind === 'rotateRight') [docW,docH] = [docH,docW];
    preview.width = docW; preview.height = docH; preview.style.width = `${docW}px`; preview.style.height = `${docH}px`;
    overlay.width = docW; overlay.height = docH; overlay.style.width = `${docW}px`; overlay.style.height = `${docH}px`;
    $('docWidth').value = docW; $('docHeight').value = docH; artworkChanged = true; isDirty = true; renderLayers(); updateDimensions(); resetView(); toast('Полотно трансформовано');
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function exportPNG() {
    const out = compositeDocument(); out.toBlob(blob => { if (blob) downloadBlob(blob, 'pxl-studio-artwork.png'); else toast('Не вдалося експортувати PNG'); }, 'image/png');
  }
  function saveProject() {
    const data = { app:'PXL Studio', version:1, width:docW, height:docH, activeId, layers:layers.map(l => ({id:l.id,name:l.name,visible:l.visible,opacity:l.opacity,locked:l.locked,blend:l.blend,isBackground:Boolean(l.isBackground),image:l.canvas.toDataURL('image/png')})) };
    const blob = new Blob([JSON.stringify(data)], {type:'application/json'}); downloadBlob(blob, 'my-pxl-project.pxl'); isDirty = false; updateStatus('Проєкт збережено'); toast('Проєкт збережено');
  }
  async function openProject(file) {
    try {
      const data = JSON.parse(await file.text()); if (!data || data.app !== 'PXL Studio' || !Array.isArray(data.layers) || !data.layers.length) throw new Error('Невідомий формат');
      docW = clamp(Number(data.width)||1200,64,4096); docH = clamp(Number(data.height)||900,64,4096);
      layers = [];
      for (const [index, item] of data.layers.slice(0,MAX_LAYERS).entries()) {
        const image = new Image(); image.src = item.image; await image.decode();
        const layer = makeLayer(item.name || 'Шар');
        layer.id = Number(item.id) || nextLayerId++;
        layer.visible = item.visible !== false;
        layer.opacity = clamp(Number(item.opacity ?? 1),0,1);
        layer.locked = Boolean(item.locked);
        layer.blend = item.blend || 'source-over';
        // Backward compatibility with projects created before the background flag existed.
        layer.isBackground = item.isBackground === true || (item.isBackground == null && index === 0 && item.name === 'Фон');
        layerCtx(layer).drawImage(image,0,0,docW,docH);
        layers.push(layer);
        nextLayerId = Math.max(nextLayerId,layer.id+1);
      }
      activeId = layers.some(l=>l.id===data.activeId) ? data.activeId : layers[layers.length-1].id;
      preview.width=docW;preview.height=docH;preview.style.width=`${docW}px`;preview.style.height=`${docH}px`;
      overlay.width=docW;overlay.height=docH;overlay.style.width=`${docW}px`;overlay.style.height=`${docH}px`;
      selectionRect=null; selectionDrag=null; floatingSelection=null; selectionClipboard=null;
      history=[];redoHistory=[];artworkChanged=true;isDirty=false;renderLayers();updateDimensions();resetView();updateHistoryButtons();updateStatus('Проєкт відкрито');toast('Проєкт відкрито');
    } catch (err) { console.error(err); toast(`Не вдалося відкрити проєкт: ${err.message}`); }
  }
  async function importImage(file) {
    const url = URL.createObjectURL(file); const image = new Image();
    image.onload = () => { if(layers.length>=MAX_LAYERS){URL.revokeObjectURL(url);return toast(`Максимум ${MAX_LAYERS} шарів`);} record(); const layer = makeLayer(file.name.replace(/\.[^.]+$/,'') || 'Імпорт'); const scale = Math.min(docW/image.width,docH/image.height,1); const w=image.width*scale,h=image.height*scale; layerCtx(layer).drawImage(image,(docW-w)/2,(docH-h)/2,w,h); layers.push(layer); activeId=layer.id; artworkChanged=true; isDirty=true; renderLayers();URL.revokeObjectURL(url); toast('Зображення додано окремим шаром'); };
    image.onerror = () => { URL.revokeObjectURL(url); toast('Не вдалося відкрити зображення'); }; image.src=url;
  }

  function panStartAt(event) {
    panning = true; panPointer = event.pointerId; panStart = {x:event.clientX,y:event.clientY,panX,panY};
    try { stage.setPointerCapture(event.pointerId); } catch (_) {}
  }
  function angleBetween(a,b) { return Math.atan2(b.y-a.y,b.x-a.x) * 180 / Math.PI; }
  function beginGesture() {
    const pts=[...pointers.values()]; if(pts.length<2)return;
    hideBrushCursor();
    if (selectionDrag) finishSelectionAction({pointerId:selectionDrag.pointerId}, true);
    if(drawing) finishStroke(false);
    const center={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2}; const doc=screenToDoc(center.x,center.y);
    gesture={distance:Math.max(1,Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y)),angle:angleBetween(pts[0],pts[1]),zoom,rotation:viewRotation,doc,center};
    suppressTouchDrawing=true;
  }
  function moveGesture() {
    if(!gesture||pointers.size<2)return;
    const pts=[...pointers.values()], center={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
    zoom=clamp(gesture.zoom*Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y)/gesture.distance,.15,8);
    const rawAngleDelta=angleBetween(pts[0],pts[1])-gesture.angle;
    const angleDelta=((rawAngleDelta+540)%360)-180;
    viewRotation=gesture.rotation+angleDelta;
    const sw=Math.max(1,stage.clientWidth), sh=Math.max(1,stage.clientHeight), a=rad(viewRotation);
    const boundsW=Math.abs(Math.cos(a))*docW+Math.abs(Math.sin(a))*docH, boundsH=Math.abs(Math.sin(a))*docW+Math.abs(Math.cos(a))*docH;
    fitScale=clamp(Math.min((sw-54)/boundsW,(sh-54)/boundsH),.015,8);
    const p=stagePoint(center.x,center.y), scale=fitScale*zoom, dx=(gesture.doc.x-docW/2)*scale, dy=(gesture.doc.y-docH/2)*scale;
    panX=p.x-stage.clientWidth/2-(dx*Math.cos(a)-dy*Math.sin(a)); panY=p.y-stage.clientHeight/2-(dx*Math.sin(a)+dy*Math.cos(a)); updateSheetTransform();
  }
  // Touch state is kept separate from mouse / pen input. If Android or the
  // WebView drops a pointerup event, the next primary touch starts a clean
  // session instead of being mistaken for the second finger of a pinch.
  function resetTouchSession(cancelStroke = true) {
    if (cancelStroke && drawing) finishStroke(false);
    pointers.clear();
    gesture = null;
    suppressTouchDrawing = false;
  }

  function endTouchPointer(event, cancelled = false) {
    const id = event.pointerId;
    const wasTracked = pointers.has(id);
    const wasGesture = Boolean(gesture || suppressTouchDrawing);

    if (wasTracked) pointers.delete(id);

    // A cancelled / unexpectedly lost drawing pointer must never commit a
    // partial stroke. A normal pointerup commits only the finger that began it.
    if (drawing && activePointer === id) {
      finishStroke(!cancelled && !wasGesture);
    }

    if (!wasTracked) return;

    if (wasGesture) {
      if (pointers.size < 2) gesture = null;
      // Do not turn the last finger of a pinch into a drawing finger.
      if (pointers.size === 0) suppressTouchDrawing = false;
      return;
    }

    if (pointers.size === 0) {
      gesture = null;
      suppressTouchDrawing = false;
    }
  }

  function pointerDown(event) {
    if (event.target.closest('.stage-tools')) return;
    trackBrushCursor(event);

    if (event.pointerType === 'touch') {
      event.preventDefault();

      // Per Pointer Events, the first finger in a new touch sequence is
      // primary. If our map still contains pointers, their up/cancel was lost.
      if (event.isPrimary && pointers.size > 0) resetTouchSession(true);

      try { stage.setPointerCapture(event.pointerId); } catch (_) {}
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size === 1) {
        if (!suppressTouchDrawing) startStroke(event);
      } else if (!gesture) {
        // A second finger starts a pinch. Further fingers do not restart it.
        beginGesture();
      }
      return;
    }

    if (event.button === 1 || event.button === 2 || (spaceDown && event.button === 0)) {
      event.preventDefault();
      panStartAt(event);
      return;
    }
    if (event.button === 0) startStroke(event);
  }

  function pointerMove(event) {
    if (panning && event.pointerId === panPointer) {
      hideBrushCursor();
      panX = panStart.panX + event.clientX - panStart.x;
      panY = panStart.panY + event.clientY - panStart.y;
      updateSheetTransform();
      event.preventDefault();
      return;
    }

    if (event.pointerType === 'touch') {
      // Ignore touch moves that do not belong to the current active session.
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size >= 2) {
        hideBrushCursor();
        moveGesture();
        event.preventDefault();
        return;
      }
      // After pinch, the remaining finger may not resume drawing.
      if (suppressTouchDrawing) return;
    }

    if (moveSelectionAction(event)) { event.preventDefault(); return; }
    trackBrushCursor(event);
    moveStroke(event);
  }

  function pointerUp(event) {
    const selectionHandled = finishSelectionAction(event, false);
    if (event.pointerType === 'touch') { endTouchPointer(event, false); return; }
    if (selectionHandled) return;
    if (panning && event.pointerId === panPointer) {
      panning = false;
      panPointer = null;
      panStart = null;
      return;
    }
    if (drawing && activePointer === event.pointerId) finishStroke(true);
  }

  function pointerCancel(event) {
    const selectionHandled = finishSelectionAction(event, true);
    if (event.pointerType === 'touch') { endTouchPointer(event, true); return; }
    if (selectionHandled) return;
    if (panning && event.pointerId === panPointer) {
      panning = false;
      panPointer = null;
      panStart = null;
    }
    if (drawing && activePointer === event.pointerId) finishStroke(false);
  }

  function pointerCaptureLost(event) {
    if (selectionDrag && selectionDrag.pointerId === event.pointerId) finishSelectionAction(event, true);
    // pointerup normally removes the pointer first, so this is only a fallback
    // for browsers that unexpectedly release capture while a contact is live.
    if (panning && event.pointerId === panPointer) {
      panning = false;
      panPointer = null;
      panStart = null;
    }
    if (pointers.has(event.pointerId) || (drawing && activePointer === event.pointerId)) {
      endTouchPointer(event, true);
    } else if (drawing && activePointer === event.pointerId) {
      finishStroke(false);
    }
  }

  function cancelAllPointers() {
    if (drawing) finishStroke(false);
    if (selectionDrag) finishSelectionAction({pointerId:selectionDrag.pointerId}, true);
    selectionDrag = null;
    pointers.clear();
    gesture = null;
    suppressTouchDrawing = false;
    panning = false;
    panPointer = null;
    panStart = null;
  }

  function openPanel(id) {
    document.querySelectorAll('.inspector-tab').forEach(b=>b.classList.toggle('active',b.dataset.panel===id));
    document.querySelectorAll('.panel-body').forEach(p=>p.classList.toggle('active',p.id===id));
  }
  function bindEvents() {
    document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
    document.querySelectorAll('[data-brush]').forEach(b=>b.addEventListener('click',()=>setBrush(b.dataset.brush)));
    document.querySelectorAll('.inspector-tab').forEach(b=>b.addEventListener('click',()=>openPanel(b.dataset.panel)));
    document.querySelectorAll('[data-color]').forEach(b=>b.addEventListener('click',()=>setColor(b.dataset.color)));
    colorInput.addEventListener('input',()=>setColor(colorInput.value));
    $('clearRecentColors').addEventListener('click',()=>{recentColors=[];try{localStorage.removeItem('pxlStudio.recentColors');}catch(_){}renderRecentColors();toast('Історію кольорів очищено');});
    $('textSize').addEventListener('input',()=>{$('textSizeOut').textContent=`${$('textSize').value} px`;});
    $('textCancelBtn').addEventListener('click',()=>{$('textDialog').close();pendingTextPoint=null;});
    $('textInsertBtn').addEventListener('click',()=>{const point=pendingTextPoint,value=$('textContent').value;$('textDialog').close();pendingTextPoint=null;if(point)insertTextAt(point,value);});
    $('textContent').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('textInsertBtn').click();}});
    $('swapColors').addEventListener('click',()=>{const a=foregroundColor;setColor(backgroundColor);backgroundColor=a;});
    brushSize.addEventListener('input', () => updateBrushControls(true));
    $('brushSizeColor').addEventListener('input', () => { brushSize.value = $('brushSizeColor').value; updateBrushControls(true); });
    brushOpacity.addEventListener('input', updateBrushControls);
    brushHardness.addEventListener('input', updateBrushControls);
    $('undoBtn').addEventListener('click',undo); $('redoBtn').addEventListener('click',redo);
    $('exportBtn').addEventListener('click',exportPNG); $('saveProjectBtn').addEventListener('click',saveProject);
    $('openProjectBtn').addEventListener('click',()=>$('projectFile').click()); $('projectFile').addEventListener('change',e=>{if(e.target.files[0])openProject(e.target.files[0]);e.target.value='';});
    $('addImageBtn').addEventListener('click',()=>$('imageFile').click()); $('importImageBtn').addEventListener('click',()=>$('imageFile').click());
    $('imageFile').addEventListener('change',e=>{if(e.target.files[0])importImage(e.target.files[0]);e.target.value='';});
    $('addLayerBtn').addEventListener('click',()=>addLayer()); $('duplicateLayerBtn').addEventListener('click',duplicateLayer); $('deleteLayerBtn').addEventListener('click',deleteLayer);
    $('layerUpBtn').addEventListener('click',()=>moveLayer(1)); $('layerDownBtn').addEventListener('click',()=>moveLayer(-1)); $('renameLayerBtn').addEventListener('click',renameLayer);
    let opacityRecorded = false;
    const beginOpacityEdit = () => { if (!opacityRecorded) { record(); opacityRecorded = true; } };
    $('layerOpacity').addEventListener('pointerdown', beginOpacityEdit);
    $('layerOpacity').addEventListener('keydown', beginOpacityEdit);
    $('layerOpacity').addEventListener('input',()=>{beginOpacityEdit();const l=activeLayer();if(!l)return;l.opacity=Number($('layerOpacity').value)/100;$('layerOpacityOut').textContent=`${$('layerOpacity').value}%`;l.canvas.style.opacity=String(l.opacity);renderLayerList();});
    $('layerOpacity').addEventListener('change',()=>{opacityRecorded=false;renderLayers();});
    document.querySelectorAll('[data-size]').forEach(b=>b.addEventListener('click',()=>{const sizes={square:[1080,1080],portrait:[900,1200],landscape:[1200,900],story:[1080,1920]};$('docWidth').value=sizes[b.dataset.size][0];$('docHeight').value=sizes[b.dataset.size][1];}));
    $('applySizeBtn').addEventListener('click',()=>setCanvasSize($('docWidth').value,$('docHeight').value,false));
    $('rotateDocLeft').addEventListener('click',()=>transformDocument('rotateLeft')); $('rotateDocRight').addEventListener('click',()=>transformDocument('rotateRight'));
    $('flipHorizontal').addEventListener('click',()=>transformDocument('flipH')); $('flipVertical').addEventListener('click',()=>transformDocument('flipV'));
    $('symmetryToggle').addEventListener('click',()=>{symmetryEnabled=!symmetryEnabled;$('symmetryToggle').setAttribute('aria-pressed',String(symmetryEnabled));$('symmetryToggle').textContent=symmetryEnabled?'Вимкнути вісь симетрії':'Увімкнути вісь симетрії';drawOverlay();toast(symmetryEnabled?'Симетричне малювання увімкнено':'Симетричне малювання вимкнено');});
    $('copySelectionBtn').addEventListener('click',copySelection); $('cutSelectionBtn').addEventListener('click',cutSelection); $('pasteSelectionBtn').addEventListener('click',pasteSelection); $('deleteSelectionBtn').addEventListener('click',deleteSelection); $('clearSelectionBtn').addEventListener('click',clearSelection);
    $('viewRotateLeft').addEventListener('click',()=>{viewRotation-=15;updateSheetTransform();}); $('viewRotateRight').addEventListener('click',()=>{viewRotation+=15;updateSheetTransform();});
    $('viewReset').addEventListener('click',resetView); $('resetView').addEventListener('click',resetView); $('fitView').addEventListener('click',fitView);
    $('zoomIn').addEventListener('click',()=>{const r=stage.getBoundingClientRect();zoomAt(zoom*1.25,r.left+r.width/2,r.top+r.height/2);});
    $('zoomOut').addEventListener('click',()=>{const r=stage.getBoundingClientRect();zoomAt(zoom/1.25,r.left+r.width/2,r.top+r.height/2);});
    stage.addEventListener('wheel',e=>{e.preventDefault();zoomAt(zoom*(e.deltaY<0?1.12:1/1.12),e.clientX,e.clientY);},{passive:false});
    stage.addEventListener('pointerdown', pointerDown);
    stage.addEventListener('pointermove', pointerMove);
    stage.addEventListener('pointerup', pointerUp);
    stage.addEventListener('pointercancel', pointerCancel);
    stage.addEventListener('lostpointercapture', pointerCaptureLost);
    stage.addEventListener('pointerleave', event => {
      if (event.pointerType !== 'touch' && !drawing) hideBrushCursor();
    });
    stage.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown',e=>{
      const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (editing && e.key !== 'Escape') return;
      if(e.code==='Space' && !editing){spaceDown=true;e.preventDefault();}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();}
      else if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==='y'||(e.shiftKey&&e.key.toLowerCase()==='z'))){e.preventDefault();redo();}
      else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();exportPNG();}
      else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='c'&&tool==='select'){e.preventDefault();copySelection();}
      else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='x'&&tool==='select'){e.preventDefault();cutSelection();}
      else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='v'&&tool==='select'){e.preventDefault();pasteSelection();}
      else if(e.key==='Escape'&&(selectionRect||floatingSelection||selectionDrag)){e.preventDefault();clearSelection();}
      else if(e.key==='Delete'&&selectionRect&&tool==='select'){e.preventDefault();deleteSelection();}
      else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'b') setTool('brush');
        if (key === 'e') setTool('eraser');
        if (key === 'i') setTool('eyedropper');
        if (key === 'g') setTool('fill');
        if (key === 'm') setTool('select');
        if (key === 't') setTool('text');
        if (key === '[') {
          brushSize.value = clamp(Number(brushSize.value) - 1, 1, 160);
          updateBrushControls(true);
        } else if (key === ']') {
          brushSize.value = clamp(Number(brushSize.value) + 1, 1, 160);
          updateBrushControls(true);
        }
      }
    });
    window.addEventListener('keyup',e=>{if(e.code==='Space')spaceDown=false;});
    window.addEventListener('blur',()=>{spaceDown=false;cancelAllPointers();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelAllPointers();});
    $('dialogConfirm').addEventListener('click',e=>e.preventDefault());
  }

  function init() {
    layers=[makeLayer('Фон', '#ffffff', true),makeLayer('Шар 1')]; activeId=layers[1].id;
    preview.width=docW;preview.height=docH;preview.style.width=`${docW}px`;preview.style.height=`${docH}px`;
    overlay.width=docW;overlay.height=docH;overlay.style.width=`${docW}px`;overlay.style.height=`${docH}px`;
    setColor(foregroundColor); loadRecentColors(); updateBrushControls(); setBrush('pen'); setTool('brush');
    renderLayers(); updateDimensions(); bindEvents();
    const resize = new ResizeObserver(()=>updateSheetTransform()); resize.observe(stage); updateSheetTransform();
    $('canvasStatus').textContent='Готово до малювання';
    hideBrushCursor();
  }
  init();
})();
