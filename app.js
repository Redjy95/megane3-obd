// ============================================================
//  OBD MÉGANE 3 — interface
//  Renault Mégane III Grand Tour 1.5 dCi 110cv (KZ1G, 81 kW)
// ============================================================

const HISTORY_KEY = 'obd-megane3-historico';
const ui = { busy: false, live: false, liveTimer: null, wakeLock: null, lastLive: {}, lastDtcs: null, lastFreeze: null, lastInfo: {} };

const $ = id => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showToast(msg, duration = 2800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove('show'), duration);
}

const fmt = (n, d = 0) => Number(n).toLocaleString('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---- NAVEGAÇÃO ----
function navigateTo(screen) {
  if (screen !== 'motor') stopLive();
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + screen));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.id === 'nav-' + screen));
  window.scrollTo(0, 0);
}

// ---- LIGAÇÃO ----
async function connect() {
  if (obdIsConnected()) { disconnect(); return; }
  setBusy(true);
  try {
    const name = await obdConnect(t => setStatus(t, 'wait'));
    setStatus('Ligado a ' + name + (obd.protocol ? ' · ' + obd.protocol : ''), 'ok');
    setConnected(true);
    showToast('✅ Ligado ao carro');
  } catch (e) {
    if (e && e.name === 'NotFoundError') setStatus('Nenhum adaptador escolhido', 'off');
    else setStatus('⚠️ ' + (e.message || e), 'error');
    obdDisconnect();
    setConnected(false);
  } finally { setBusy(false); }
}

function disconnect() {
  stopLive();
  obdDisconnect();
  setConnected(false);
  setStatus('Desligado', 'off');
}

obd.onDisconnect = () => {
  stopLive();
  setConnected(false);
  setStatus('⚠️ Ligação perdida. Volte a ligar.', 'error');
};

obd.onLog = text => {
  const el = $('log');
  const stamp = new Date().toLocaleTimeString('pt-PT');
  const lines = (el.textContent + '\n[' + stamp + '] ' + text).trim().split('\n');
  el.textContent = lines.slice(-400).join('\n');
};

function setStatus(text, kind = 'off') {
  $('conn-text').textContent = text;
  $('conn-dot').className = 'conn-dot ' + kind;
}

function setConnected(on) {
  $('conn-btn').textContent = on ? 'Desligar' : 'Ligar';
  $('conn-btn').classList.toggle('btn-outline', on);
  $('conn-btn').classList.toggle('btn-primary', !on);
  document.querySelectorAll('[data-needs-obd]').forEach(b => { b.disabled = !on || ui.busy; });
  if (on) $('info-adapter').innerHTML = infoRows([
    ['Adaptador', escapeHtml(obd.device?.name || '—')],
    ['Versão ELM', escapeHtml(obd.elm || '—')],
    ['Protocolo', escapeHtml(obd.protocol || '—')],
    ['PIDs suportados', obd.supported.size ? [...obd.supported].map(p => p.toString(16).toUpperCase().padStart(2, '0')).join(' ') : '—']
  ]);
}

function setBusy(on) {
  ui.busy = on;
  document.querySelectorAll('[data-needs-obd]').forEach(b => { b.disabled = on || !obdIsConnected(); });
  $('conn-btn').disabled = on && !obdIsConnected();
}

// Evita comandos em simultâneo e mostra erros
async function run(fn) {
  if (!obdIsConnected()) { showToast('⚠️ Ligue primeiro ao adaptador'); return; }
  if (ui.busy) return;
  setBusy(true);
  try { await fn(); }
  catch (e) { showToast('⚠️ ' + (e.message || e)); }
  finally { setBusy(false); }
}

// ---- AVARIAS ----
function readDtcs() {
  return run(async () => {
    const mil = await obdReadMilStatus();
    const { stored, pending } = await obdReadDtcs();
    ui.lastDtcs = { mil, stored, pending, date: new Date().toISOString() };
    showMil(mil, stored.length);
    showDtcList('dtc-stored', stored, 'Sem avarias confirmadas');
    showDtcList('dtc-pending', pending, 'Sem avarias pendentes');
    ui.lastFreeze = stored.length ? await obdReadFreezeFrame() : null;
    showFreeze(ui.lastFreeze);
    saveHistory({ date: ui.lastDtcs.date, stored, pending, mil: mil?.mil ?? null });
    showToast(stored.length || pending.length ? `⚠️ ${stored.length + pending.length} código(s) encontrado(s)` : '✅ Sem avarias');
  });
}

function clearDtcs() {
  if (!confirm('Apagar os códigos de avaria?\n\nFaça-o só depois de resolver o problema e com a ignição ligada e o motor desligado. A luz do motor apaga, mas volta se a avaria continuar. Os dados do momento da avaria também se perdem.')) return;
  return run(async () => {
    if (await obdClearDtcs()) {
      showToast('✅ Códigos apagados');
      ui.lastDtcs = { mil: { mil: false, count: 0 }, stored: [], pending: [], date: new Date().toISOString() };
      showMil(ui.lastDtcs.mil, 0);
      showDtcList('dtc-stored', [], 'Sem avarias confirmadas');
      showDtcList('dtc-pending', [], 'Sem avarias pendentes');
      showFreeze(null);
      saveHistory({ date: ui.lastDtcs.date, cleared: true });
    } else showToast('⚠️ O carro não aceitou (ignição ligada, motor desligado?)');
  });
}

function showMil(mil, storedCount) {
  const el = $('mil');
  if (!mil) { el.innerHTML = '<span class="text-muted">Estado da luz do motor não disponível</span>'; return; }
  el.innerHTML = mil.mil
    ? `<div class="mil-box red"><span class="mil-icon">⚠️</span><div><strong>Luz do motor ACESA</strong><div class="text-sm">A centralina indica ${mil.count} código(s) ativo(s).</div></div></div>`
    : `<div class="mil-box green"><span class="mil-icon">✓</span><div><strong>Luz do motor apagada</strong><div class="text-sm">${storedCount ? 'Há códigos guardados, mas a luz não está acesa.' : 'Nada a assinalar.'}</div></div></div>`;
}

function showDtcList(id, codes, emptyText) {
  $(id).innerHTML = codes.length
    ? codes.map(c => {
        const d = dtcDescribe(c);
        return `<div class="dtc-item"><div class="dtc-code">${c}</div><div class="dtc-text${d.known ? '' : ' text-muted'}">${escapeHtml(d.text)}</div></div>`;
      }).join('')
    : `<span class="ok-text">✓ ${emptyText}</span>`;
}

function showFreeze(f) {
  const card = $('freeze-card');
  if (!f) { card.style.display = 'none'; return; }
  card.style.display = '';
  $('freeze').innerHTML = infoRows([
    ['Código que gravou os dados', `<span class="dtc-code sm">${f.dtc}</span>`],
    ['Temperatura do motor', f.coolant !== undefined ? f.coolant + ' °C' : '—'],
    ['Rotações', f.rpm !== undefined ? fmt(f.rpm) + ' rpm' : '—'],
    ['Velocidade', f.speed !== undefined ? f.speed + ' km/h' : '—'],
    ['Carga do motor', f.load !== undefined ? f.load + ' %' : '—'],
    ['Pressão de admissão', f.map !== undefined ? fmt(f.map / 100, 2) + ' bar' : '—'],
    ['Temperatura do ar', f.iat !== undefined ? f.iat + ' °C' : '—']
  ]);
}

// ---- HISTÓRICO DE LEITURAS ----
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}

function saveHistory(entry) {
  const h = loadHistory();
  h.unshift(entry);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 50))); } catch {}
  renderHistory();
}

function clearHistory() {
  if (!confirm('Apagar o histórico de leituras guardado neste telemóvel?')) return;
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
  renderHistory();
}

function renderHistory() {
  const h = loadHistory();
  $('history').innerHTML = h.length
    ? h.map(e => {
        const d = new Date(e.date);
        const when = d.toLocaleDateString('pt-PT') + ' ' + d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
        let what;
        if (e.cleared) what = '<span class="text-muted">Códigos apagados</span>';
        else {
          const all = [...(e.stored || []), ...(e.pending || []).map(c => c + ' (pendente)')];
          what = all.length ? all.map(c => `<span class="hist-tag">${escapeHtml(c)}</span>`).join('') : '<span class="ok-text">Sem avarias</span>';
        }
        return `<div class="hist-row"><div class="hist-when">${when}</div><div class="hist-what">${what}</div></div>`;
      }).join('')
    : '<span class="text-muted">Ainda sem leituras.</span>';
}

// ---- MOTOR (TEMPO REAL) ----
function readLiveOnce() {
  return run(async () => { showLive(await obdReadLive()); });
}

async function toggleLive() {
  if (ui.live) { stopLive(); return; }
  if (!obdIsConnected()) { showToast('⚠️ Ligue primeiro ao adaptador'); return; }
  if (ui.busy) return;
  ui.live = true;
  setBusy(true);
  $('live-btn').disabled = false;
  $('live-btn').textContent = '■ Parar';
  $('live-btn').classList.replace('btn-primary', 'btn-danger');
  try { ui.wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  try {
    while (ui.live && obdIsConnected()) {
      showLive(await obdReadLive());
      await new Promise(r => setTimeout(r, 400));
    }
  } catch (e) { if (ui.live) showToast('⚠️ ' + (e.message || e)); }
  finally {
    ui.live = false;
    try { ui.wakeLock?.release(); } catch {}
    ui.wakeLock = null;
    $('live-btn').textContent = '▶ Atualizar continuamente';
    $('live-btn').classList.replace('btn-danger', 'btn-primary');
    setBusy(false);
  }
}

function stopLive() { ui.live = false; }

function batteryState(v, rpm) {
  if (rpm > 0) return v >= 13.5 ? ['a carregar', 'green'] : v >= 12.8 ? ['carga fraca', 'yellow'] : ['alternador?', 'red'];
  return v >= 13.2 ? ['a carregar', 'green'] : v >= 12.4 ? ['boa', 'green'] : v >= 12.0 ? ['fraca', 'yellow'] : ['muito fraca', 'red'];
}

function showLive(d) {
  ui.lastLive = d;
  const tile = (id, val, unit, note = '', color = '') => {
    const el = $(id);
    if (!el) return;
    el.querySelector('.gauge-val').innerHTML = val === undefined || val === null ? '—' : `${val}<span class="gauge-unit">${unit}</span>`;
    el.querySelector('.gauge-note').textContent = note;
    el.className = 'gauge' + (color ? ' ' + color : '') + (val === undefined || val === null ? ' off' : '');
  };
  if (d.battery !== undefined) { const [t, c] = batteryState(d.battery, d.rpm); tile('g-battery', fmt(d.battery, 1), ' V', t, c); }
  else tile('g-battery', null, '', 'não disponível');
  tile('g-coolant', d.coolant, ' °C', d.coolant === undefined ? 'não disponível' : d.coolant >= 105 ? 'alta!' : d.coolant >= 75 ? 'normal' : 'motor frio', d.coolant >= 105 ? 'red' : d.coolant >= 75 ? 'green' : 'blue');
  tile('g-rpm', d.rpm !== undefined ? fmt(d.rpm) : undefined, ' rpm', d.rpm === 0 ? 'motor desligado' : '');
  tile('g-speed', d.speed, ' km/h', d.speed > 0 ? 'pare o carro!' : '', d.speed > 0 ? 'red' : '');
  const boost = d.map !== undefined ? (d.map - (d.baro ?? 101)) / 100 : undefined;
  tile('g-boost', boost !== undefined ? fmt(boost, 2) : undefined, ' bar', boost !== undefined ? `absoluta ${fmt(d.map / 100, 2)} bar` : 'não disponível');
  tile('g-load', d.load, ' %', d.load === undefined ? 'não disponível' : '');
  tile('g-iat', d.iat, ' °C', d.iat === undefined ? 'não disponível' : '');
  tile('g-maf', d.maf !== undefined ? fmt(d.maf, 1) : undefined, ' g/s', d.maf === undefined ? 'não disponível' : '');
  tile('g-rail', d.rail !== undefined ? fmt(d.rail / 100) : undefined, ' bar', d.rail === undefined ? 'não disponível' : '');
  tile('g-ecu', d.ecuVolt !== undefined ? fmt(d.ecuVolt, 1) : undefined, ' V', d.ecuVolt === undefined ? 'não disponível' : '');
  $('live-time').textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-PT');
}

// ---- CARRO ----
function readCarInfo() {
  return run(async () => {
    const vin = await obdReadVin();
    const dist = await obdReadDistances();
    ui.lastInfo = { vin, ...dist };
    $('info-car').innerHTML = infoRows([
      ['VIN', vin ? `<span class="mono">${vin}</span>` : '<span class="text-muted">não enviado pelo carro</span>'],
      ['Conta-km (PID A6)', dist.odometer !== undefined ? `<strong>${fmt(dist.odometer)} km</strong>` : '<span class="warn-text">não disponível</span>'],
      ['Desde a última limpeza de avarias', dist.sinceClear !== undefined ? fmt(dist.sinceClear) + ' km' : '—'],
      ['Com a luz do motor acesa', dist.withMil !== undefined ? fmt(dist.withMil) + ' km' : '—']
    ]) + (dist.odometer === undefined ? '<div class="text-muted text-sm mt-8">O Mégane III de 2010 normalmente não envia o conta-km pelo OBD standard. Veja-o no quadrante.</div>' : '');
  });
}

function infoRows(rows) {
  return rows.map(([k, v]) => `<div class="info-row"><span class="text-muted">${k}</span><span class="info-val">${v}</span></div>`).join('');
}

// ---- REGISTO E RELATÓRIO ----
function buildReport() {
  const L = [];
  L.push('Relatório OBD — Renault Mégane III Grand Tour 1.5 dCi 110cv (KZ1G)');
  L.push('Data: ' + new Date().toLocaleString('pt-PT'));
  if (obd.device) L.push(`Adaptador: ${obd.device.name || '—'} · ${obd.elm || ''} · ${obd.protocol || ''}`);
  const d = ui.lastDtcs;
  if (d) {
    L.push('');
    L.push('Luz do motor: ' + (d.mil ? (d.mil.mil ? 'ACESA' : 'apagada') : 'desconhecido'));
    L.push('Avarias confirmadas: ' + (d.stored.length ? d.stored.map(c => `${c} (${dtcDescribe(c).text})`).join('; ') : 'nenhuma'));
    L.push('Avarias pendentes: ' + (d.pending.length ? d.pending.map(c => `${c} (${dtcDescribe(c).text})`).join('; ') : 'nenhuma'));
  }
  const f = ui.lastFreeze;
  if (f) L.push(`Dados da avaria ${f.dtc}: ${f.coolant ?? '—'} °C, ${f.rpm ?? '—'} rpm, ${f.speed ?? '—'} km/h, carga ${f.load ?? '—'} %`);
  const v = ui.lastLive;
  if (v && Object.keys(v).length) {
    L.push('');
    L.push(`Bateria: ${v.battery ?? '—'} V · Motor: ${v.coolant ?? '—'} °C · ${v.rpm ?? '—'} rpm`);
  }
  const i = ui.lastInfo;
  if (i.vin) L.push('VIN: ' + i.vin);
  if (i.odometer !== undefined) L.push('Conta-km: ' + i.odometer + ' km');
  return L.join('\n');
}

async function shareReport() {
  const text = buildReport();
  try {
    if (navigator.share) { await navigator.share({ title: 'Relatório OBD Mégane', text }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  copyText(text, '✅ Relatório copiado');
}

function copyLog() { copyText($('log').textContent || '(vazio)', '✅ Registo copiado'); }

function clearLog() { $('log').textContent = ''; }

async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); showToast(okMsg); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast(okMsg); } catch { showToast('⚠️ Não foi possível copiar'); }
    ta.remove();
  }
}

// Comando manual (para testes avançados)
function sendManual(ev) {
  ev.preventDefault();
  const input = $('manual-cmd');
  const cmd = input.value.trim().toUpperCase();
  if (!cmd) return;
  if (/^0?4$/.test(cmd) || /^14/.test(cmd)) { showToast('⚠️ Use o botão "Apagar avarias"'); return; }
  run(async () => { await obdSend(cmd, 8000); input.value = ''; });
}

// ---- ARRANQUE ----
window.addEventListener('DOMContentLoaded', () => {
  const ok = obdSupported();
  $('unsupported').style.display = ok ? 'none' : '';
  $('conn-btn').disabled = !ok;
  setConnected(false);
  setStatus(ok ? 'Desligado' : 'Bluetooth indisponível neste browser', ok ? 'off' : 'error');
  renderHistory();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
});
