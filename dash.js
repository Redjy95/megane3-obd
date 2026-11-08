// ============================================================
//  Painéis personalizáveis, lista de sensores e leitura contínua
// ============================================================

const DASH_KEY = 'obd-megane3-paineis';
const live = { running: false, paused: false, values: {}, hist: {}, rec: null, editing: false, dashIdx: 0 };
const HIST_LEN = 90;

const newId = () => Math.random().toString(36).slice(2, 9);
const W = (key, type) => ({ id: newId(), key, type });

// Painéis de origem com mais dados do que cabem: ao ligar ao carro,
// os que ele não envia são retirados (ver adaptDashes).
function presetDashes() {
  return [
    { name: 'Motor', widgets: [W('rpm', 'gauge'), W('coolant', 'gauge'), W('battery', 'number'), W('speed', 'number'), W('load', 'number'), W('iat', 'number'), W('pedal', 'number'), W('torque', 'number'), W('oil', 'number'), W('runTime', 'number'), W('rpm', 'chart')] },
    { name: 'Turbo', widgets: [W('boost', 'gauge'), W('maf', 'gauge'), W('boostCmd', 'number'), W('boostAct', 'number'), W('map', 'number'), W('baro', 'number'), W('iat', 'number'), W('boost', 'chart'), W('maf', 'chart')] },
    { name: 'Elétrico', widgets: [W('battery', 'gauge'), W('ecuVolt', 'gauge'), W('rpm', 'number'), W('coolant', 'number'), W('battery', 'chart')] },
    { name: 'Injeção e emissões', widgets: [W('rail', 'gauge'), W('fuelRate', 'gauge'), W('railRel', 'number'), W('injTiming', 'number'), W('egrCmd', 'number'), W('egrErr', 'number'), W('dpfDp', 'number'), W('fuel', 'number'), W('rail', 'chart'), W('dpfDp', 'chart')] }
  ];
}

let dashes = loadDashes();

function loadDashes() {
  try {
    const d = JSON.parse(localStorage.getItem(DASH_KEY));
    if (Array.isArray(d) && d.length) return d;
  } catch {}
  return presetDashes();
}

// edited: o utilizador mexeu nos painéis (a partir daí não se ajustam sozinhos)
function saveDashes(edited = true) {
  try {
    localStorage.setItem(DASH_KEY, JSON.stringify(dashes));
    if (edited) localStorage.setItem(DASH_KEY + '-editados', '1');
  } catch {}
}

function dashesEdited() {
  try { return localStorage.getItem(DASH_KEY + '-editados') === '1'; } catch { return false; }
}

// Tira dos painéis os dados que este carro não envia; apaga painéis que fiquem vazios.
// Devolve o nº de dados retirados (ou -1 se ainda não se sabe o que o carro envia).
function adaptDashes(edited) {
  if (!obdIsConnected() || !obd.supported.size) return -1;
  let removed = 0;
  for (const d of dashes) {
    const before = d.widgets.length;
    d.widgets = d.widgets.filter(w => pidAvailable(w.key));
    removed += before - d.widgets.length;
  }
  const kept = dashes.filter(d => d.widgets.length);
  if (kept.length) dashes = kept;
  live.dashIdx = Math.min(live.dashIdx, dashes.length - 1);
  saveDashes(edited);
  return removed;
}

function adaptDashesButton() {
  const n = adaptDashes(true);
  if (n < 0) { showToast('⚠️ Ligue primeiro ao adaptador'); return; }
  renderDash();
  showToast(n ? `✅ Retirados ${n} dado(s) que este carro não envia` : '✅ Os painéis já só têm dados deste carro');
}

// Na ligação: ajusta sozinho os painéis de origem (se o utilizador não os mudou)
function autoAdaptDashes() {
  if (dashesEdited()) return;
  const n = adaptDashes(false);
  if (n > 0) showToast('✅ Painéis ajustados aos dados deste carro');
}

const curDash = () => dashes[Math.min(live.dashIdx, dashes.length - 1)];

// ---- LEITURA CONTÍNUA ----
const LIVE_SCREENS = ['painel', 'sensores', 'conducao'];

function liveKeys() {
  if (ui.screen === 'painel') return [...new Set(curDash().widgets.map(w => w.key))];
  if (ui.screen === 'sensores') return PIDS.filter(pidAvailable).map(p => p.key);
  if (ui.screen === 'conducao') return driveKeys();
  return [];
}

const liveShouldRun = () => obdIsConnected() && !live.paused && LIVE_SCREENS.includes(ui.screen);

// Começa a ler, se o separador aberto precisar (ou assim que acabar a leitura em curso)
function startLive() {
  if (!liveShouldRun() || live.running) return;
  if (ui.busy) { ui.wantLive = true; return; }
  liveLoop();
}

async function liveLoop() {
  live.running = true;
  setBusy(true);
  updateLiveButtons();
  try { ui.wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  try {
    while (liveShouldRun()) {
      const keys = liveKeys();
      if (!keys.length) { await new Promise(r => setTimeout(r, 500)); continue; }
      await readValues(keys, onLiveValue, () => !liveShouldRun());
      if (live.rec) recordRow();
      await new Promise(r => setTimeout(r, 150));
    }
  } catch (e) { if (obdIsConnected()) showToast('⚠️ ' + (e.message || e)); }
  finally {
    live.running = false;
    try { ui.wakeLock?.release(); } catch {}
    ui.wakeLock = null;
    setBusy(false);
    updateLiveButtons();
  }
}

function onLiveValue(key, v) {
  live.values[key] = v;
  const h = live.hist[key] || (live.hist[key] = []);
  h.push(v);
  if (h.length > HIST_LEN) h.shift();
  ui.lastLive = live.values;
  document.querySelectorAll(`[data-live="${key}"]`).forEach(el => updateLiveEl(el, key, v));
}

function togglePause() {
  live.paused = !live.paused;
  if (!live.paused) startLive();
  updateLiveButtons();
}

function updateLiveButtons() {
  const on = live.running && !live.paused;
  document.querySelectorAll('.live-pause').forEach(b => {
    b.textContent = live.paused ? '▶ Retomar' : '⏸ Pausar';
    b.disabled = !obdIsConnected();
  });
  document.querySelectorAll('.live-state').forEach(el => {
    el.textContent = !obdIsConnected() ? 'Ligue ao adaptador para ver os valores' : live.paused ? 'Em pausa' : on ? '● A atualizar' : '';
    el.classList.toggle('on', on);
  });
  const rec = $('rec-btn');
  if (rec) {
    rec.textContent = live.rec ? `■ Parar gravação (${live.rec.rows.length})` : '● Gravar';
    rec.classList.toggle('btn-danger', !!live.rec);
    rec.classList.toggle('btn-outline', !live.rec);
    rec.disabled = !obdIsConnected() && !live.rec;
  }
}

// ---- WIDGETS ----
function widgetLimits(w) {
  const p = PID_BY_KEY[w.key];
  return { lo: w.warn?.lo ?? p?.warn?.lo, hi: w.warn?.hi ?? p?.warn?.hi };
}

function isAlert(w, v) {
  if (v === undefined || v === null) return false;
  const { lo, hi } = widgetLimits(w);
  return (hi !== undefined && hi !== null && v > hi) || (lo !== undefined && lo !== null && v < lo);
}

// Mostrador semicircular (240°)
function gaugeSvg(p, v, alert) {
  const pct = v === undefined ? 0 : Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min)));
  const arc = 'M 18.4 84 A 48 48 0 1 1 101.6 84'; // de 210° a -30°, centro (60,60)
  return `<svg viewBox="0 0 120 96" class="gauge-svg" aria-hidden="true">
    <path d="${arc}" class="g-track" pathLength="100"/>
    <path d="${arc}" class="g-fill${alert ? ' alert' : ''}" pathLength="100" stroke-dasharray="${(pct * 100).toFixed(1)} 100"/>
    <text x="60" y="62" class="g-val">${v === undefined ? '—' : fmtValue(p.key, v, false)}</text>
    <text x="60" y="80" class="g-unit">${escapeHtml(p.unit)}</text>
    <text x="14" y="95" class="g-scale">${fmtValue(p.key, p.min, false)}</text>
    <text x="106" y="95" class="g-scale" text-anchor="end">${fmtValue(p.key, p.max, false)}</text>
  </svg>`;
}

// Gráfico de linha com o histórico recente
function sparkSvg(values, opts = {}) {
  const w = opts.w || 300, h = opts.h || 80;
  if (!values || values.length < 2) return `<svg viewBox="0 0 ${w} ${h}" class="spark"><text x="${w / 2}" y="${h / 2}" class="spark-empty">a recolher dados…</text></svg>`;
  let lo = Math.min(...values), hi = Math.max(...values);
  if (opts.lo !== undefined) lo = Math.min(lo, opts.lo);
  if (opts.hi !== undefined) hi = Math.max(hi, opts.hi);
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.1;
  lo -= pad; hi += pad;
  const pts = values.map((v, i) => `${(i / (values.length - 1) * w).toFixed(1)},${(h - (v - lo) / (hi - lo) * h).toFixed(1)}`).join(' ');
  const lines = (opts.marks || []).filter(m => m !== undefined && m !== null).map(m => {
    const y = (h - (m - lo) / (hi - lo) * h).toFixed(1);
    return `<line x1="0" x2="${w}" y1="${y}" y2="${y}" class="spark-mark"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" preserveAspectRatio="none">${lines}<polyline points="${pts}" class="spark-line${opts.alert ? ' alert' : ''}"/></svg>`;
}

function widgetHtml(w, idx) {
  const p = PID_BY_KEY[w.key];
  if (!p) return '';
  const off = obdIsConnected() && !pidAvailable(p);
  const cls = `w w-${w.type}${off ? ' off' : ''}`;
  const edit = live.editing ? `<button class="w-edit" onclick="openWidgetModal(${idx})" aria-label="Configurar">⚙</button>` : '';
  return `<div class="${cls}" data-live="${w.key}" data-wid="${w.id}">${edit}<div class="w-lbl">${escapeHtml(p.short || p.name)}</div><div class="w-body"></div>${off ? '<div class="w-note">não disponível neste carro</div>' : ''}</div>`;
}

function updateLiveEl(el, key, v) {
  if (el.dataset.drive) updateDriveTile(el, key, v);
  else if (el.dataset.wid) {
    const w = curDash().widgets.find(x => x.id === el.dataset.wid);
    if (w) renderWidgetBody(el, w, v);
  } else {
    el.textContent = fmtValue(key, v);
  }
}

function renderWidgetBody(el, w, v) {
  const p = PID_BY_KEY[w.key];
  const alert = isAlert(w, v);
  el.classList.toggle('alert', alert);
  const body = el.querySelector('.w-body');
  if (w.type === 'gauge') body.innerHTML = gaugeSvg(p, v, alert);
  else if (w.type === 'chart') {
    const h = live.hist[w.key] || [];
    const { lo, hi } = widgetLimits(w);
    body.innerHTML = `<div class="w-chart-head"><span class="w-val">${fmtValue(w.key, v)}</span><span class="text-muted">${h.length > 1 ? `mín ${fmtValue(w.key, Math.min(...h), false)} · máx ${fmtValue(w.key, Math.max(...h), false)}` : ''}</span></div>` + sparkSvg(h, { alert, marks: [lo, hi] });
  } else body.innerHTML = `<div class="w-val">${v === undefined ? '—' : fmtValue(w.key, v, false)}<span class="w-unit">${escapeHtml(p.unit)}</span></div>`;
}

function renderDash() {
  const d = curDash();
  $('dash-tabs').innerHTML = dashes.map((x, i) =>
    `<button class="chip${i === live.dashIdx ? ' active' : ''}" onclick="selectDash(${i})">${escapeHtml(x.name)}</button>`).join('') +
    (live.editing ? '<button class="chip" onclick="newDash()">＋ Novo</button>' : '');
  $('dash-grid').innerHTML = d.widgets.map(widgetHtml).join('') +
    (live.editing ? '<button class="w w-add" onclick="openAddModal()">＋ Adicionar dado</button>' : '') +
    (!d.widgets.length && !live.editing ? '<div class="text-muted text-sm">Painel vazio. Toque em ✎ Editar para adicionar dados.</div>' : '');
  $('dash-grid').querySelectorAll('[data-wid]').forEach(el => {
    const w = d.widgets.find(x => x.id === el.dataset.wid);
    renderWidgetBody(el, w, live.values[w.key]);
  });
  $('dash-edit-bar').style.display = live.editing ? '' : 'none';
  $('edit-btn').textContent = live.editing ? '✓ Concluir' : '✎ Editar';
  updateLiveButtons();
}

function selectDash(i) {
  live.dashIdx = i;
  try { localStorage.setItem(DASH_KEY + '-atual', i); } catch {}
  renderDash();
}

function toggleEdit() { live.editing = !live.editing; renderDash(); }

function newDash() {
  dashes.push({ name: 'Painel ' + (dashes.length + 1), widgets: [] });
  saveDashes();
  selectDash(dashes.length - 1);
}

function renameDash() {
  openModal('Nome do painel', `<input id="dash-name" class="form-input" maxlength="24" value="${escapeHtml(curDash().name)}">
    <button class="btn btn-primary btn-block mt-12" onclick="saveDashName()">Guardar</button>`);
}

function saveDashName() {
  const v = $('dash-name').value.trim();
  if (v) { curDash().name = v; saveDashes(); }
  closeModal(); renderDash();
}

function deleteDash() {
  if (dashes.length <= 1) { showToast('Tem de existir pelo menos um painel'); return; }
  if (!confirm(`Apagar o painel "${curDash().name}"?`)) return;
  dashes.splice(live.dashIdx, 1);
  saveDashes();
  selectDash(Math.max(0, live.dashIdx - 1));
}

function resetDashes() {
  if (!confirm('Repor os painéis de origem? Os seus painéis personalizados perdem-se.')) return;
  dashes = presetDashes();
  try { localStorage.removeItem(DASH_KEY + '-editados'); } catch {}
  adaptDashes(false);
  saveDashes(false);
  selectDash(0);
}

// ---- JANELAS (MODAL) ----
function openModal(title, html) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = html;
  $('modal').classList.add('open');
}

function closeModal() { $('modal').classList.remove('open'); }

const TYPE_NAMES = { gauge: 'Mostrador', number: 'Número', chart: 'Gráfico' };

function typeSelect(id, val) {
  return `<select id="${id}" class="form-input">${Object.entries(TYPE_NAMES).map(([k, n]) => `<option value="${k}"${k === val ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
}

function openAddModal(type = 'number') {
  const groups = Object.entries(CATS).map(([cat, catName]) => {
    const items = PIDS.filter(p => p.cat === cat).map(p => {
      const ok = !obdIsConnected() || pidAvailable(p);
      return `<button class="pick" ${ok ? '' : 'disabled'} onclick="addWidget('${p.key}')">${escapeHtml(p.name)}${p.unit ? ` <span class="text-muted">(${escapeHtml(p.unit)})</span>` : ''}${ok ? '' : ' <span class="text-muted">— não disponível</span>'}</button>`;
    }).join('');
    return `<div class="pick-cat">${catName}</div>${items}`;
  }).join('');
  openModal('Adicionar dado', `<label class="form-label">Aspeto</label>${typeSelect('add-type', type)}<div class="mt-12">${groups}</div>`);
}

function addWidget(key, type) {
  type = type || $('add-type')?.value || 'number';
  curDash().widgets.push(W(key, type));
  saveDashes();
  closeModal();
  renderDash();
  showToast(`✅ Adicionado a "${curDash().name}"`);
  startLive();
}

function openWidgetModal(idx) {
  const w = curDash().widgets[idx];
  const p = PID_BY_KEY[w.key];
  const { lo, hi } = widgetLimits(w);
  openModal(p.name, `
    <label class="form-label">Aspeto</label>${typeSelect('w-type', w.type)}
    <div class="form-row mt-12">
      <div><label class="form-label">Alerta abaixo de</label><input id="w-lo" type="number" step="any" inputmode="decimal" class="form-input" value="${lo ?? ''}" placeholder="sem alerta"></div>
      <div><label class="form-label">Alerta acima de</label><input id="w-hi" type="number" step="any" inputmode="decimal" class="form-input" value="${hi ?? ''}" placeholder="sem alerta"></div>
    </div>
    <div class="text-muted text-sm mt-8">Unidade: ${escapeHtml(p.unit || '—')}. Fora destes limites o dado fica vermelho.</div>
    <div class="btn-row mt-12">
      <button class="btn btn-outline" onclick="moveWidget(${idx},-1)">↑ Subir</button>
      <button class="btn btn-outline" onclick="moveWidget(${idx},1)">↓ Descer</button>
    </div>
    <div class="btn-row mt-8">
      <button class="btn btn-outline" style="color:var(--accent-red)" onclick="removeWidget(${idx})">Remover</button>
      <button class="btn btn-primary" onclick="saveWidget(${idx})">Guardar</button>
    </div>`);
}

function saveWidget(idx) {
  const w = curDash().widgets[idx];
  w.type = $('w-type').value;
  const num = id => { const v = $(id).value.trim().replace(',', '.'); return v === '' ? null : Number(v); };
  w.warn = { lo: num('w-lo'), hi: num('w-hi') };
  saveDashes(); closeModal(); renderDash();
}

function moveWidget(idx, dir) {
  const ws = curDash().widgets, j = idx + dir;
  if (j < 0 || j >= ws.length) return;
  [ws[idx], ws[j]] = [ws[j], ws[idx]];
  saveDashes(); closeModal(); renderDash();
}

function removeWidget(idx) {
  curDash().widgets.splice(idx, 1);
  saveDashes(); closeModal(); renderDash();
}

// ---- SENSORES ----
function renderSensors() {
  const connected = obdIsConnected();
  const avail = PIDS.filter(p => !connected || pidAvailable(p));
  $('sensors-count').textContent = connected
    ? `${avail.length} de ${PIDS.length} dados disponíveis neste carro`
    : 'Ligue ao adaptador para ver quais os dados que este carro envia.';
  $('sensors').innerHTML = Object.entries(CATS).map(([cat, catName]) => {
    const rows = avail.filter(p => p.cat === cat).map(p =>
      `<div class="sensor-row"><span class="sensor-name">${escapeHtml(p.name)}</span><span class="sensor-val" data-live="${p.key}">${fmtValue(p.key, live.values[p.key])}</span><button class="sensor-add" onclick="addWidget('${p.key}','number')" aria-label="Adicionar ao painel">＋</button></div>`).join('');
    return rows ? `<div class="card"><div class="card-title">${catName}</div>${rows}</div>` : '';
  }).join('');
}

// ---- GRAVAÇÃO (CSV) ----
function toggleRecord() {
  if (live.rec) { finishRecord(); return; }
  live.rec = { start: Date.now(), rows: [] };
  showToast('● A gravar. Os valores do painel aberto ficam guardados.');
  updateLiveButtons();
  startLive();
}

function recordRow() {
  live.rec.rows.push({ t: (Date.now() - live.rec.start) / 1000, ...live.values });
  if (live.rec.rows.length > 20000) finishRecord();
  updateLiveButtons();
}

async function finishRecord() {
  const rec = live.rec;
  live.rec = null;
  updateLiveButtons();
  if (!rec || !rec.rows.length) { showToast('Gravação vazia'); return; }
  const keys = PIDS.map(p => p.key).filter(k => rec.rows.some(r => r[k] !== undefined));
  const num = v => v === undefined ? '' : String(Math.round(v * 1000) / 1000).replace('.', ',');
  const head = ['Tempo (s)', ...keys.map(k => `${PID_BY_KEY[k].name} (${k === 'runTime' ? 's' : PID_BY_KEY[k].unit})`)].join(';');
  const csv = [head, ...rec.rows.map(r => [num(r.t), ...keys.map(k => num(r[k]))].join(';'))].join('\n');
  const name = `megane-obd-${new Date(rec.start).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  await shareFile(name, csv, 'text/csv');
}

async function shareFile(name, text, type) {
  try {
    const file = new File([text], name, { type });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    showToast('✅ Ficheiro gravado: ' + name);
  } catch { copyText(text, '✅ Dados copiados (cole numa folha de cálculo)'); }
}

// ---- ARRANQUE ----
window.addEventListener('DOMContentLoaded', () => {
  try { live.dashIdx = Math.min(Number(localStorage.getItem(DASH_KEY + '-atual')) || 0, dashes.length - 1); } catch {}
  renderDash();
  renderSensors();
});
