// ============================================================
//  OBD MÉGANE 3 — interface
//  Renault Mégane III Grand Tour 1.5 dCi 110cv (KZ1G, 81 kW)
// ============================================================

const HISTORY_KEY = 'obd-megane3-historico';
// Versão da app: tem de ser igual ao version.json e ao ?v= dos scripts no index.html
const APP_VERSION = 11;
const ui = { busy: false, wantLive: false, screen: 'avarias', wakeLock: null, lastLive: {}, lastDtcs: null, lastFreeze: null, lastInfo: {}, lastReadiness: null };

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
  ui.screen = screen;
  if (screen === 'painel') renderDash();
  if (screen === 'sensores') renderSensors();
  // Painel e Sensores atualizam sozinhos enquanto estiverem abertos
  if (LIVE_SCREENS.includes(screen)) startLive();
  else ui.wantLive = false;
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
  } catch (e) {
    if (e && e.name === 'NotFoundError') setStatus('Nenhum adaptador escolhido', 'off');
    else { setStatus('⚠️ ' + (e.message || e), 'error'); showToast('Veja o separador Registo e copie o texto', 5000); }
    obdDisconnect();
    setConnected(false);
  } finally { setBusy(false); }
  if (obdIsConnected()) {
    if (LIVE_SCREENS.includes(ui.screen)) ui.wantLive = true;
    autoReadAll();
  }
}

// Logo depois de ligar: lê avarias, dados do carro e motor, sem tocar em botões
function autoReadAll() {
  return run(async () => {
    showToast('🔄 A ler os dados do carro…');
    await doReadDtcs();
    await doReadReadiness();
    await doReadCarInfo();
    const v = await readValues(['battery', 'coolant', 'rpm', 'map']);
    renderAdapterInfo();
    Object.entries(v).forEach(([k, x]) => onLiveValue(k, x));
  });
}

function disconnect() {
  ui.wantLive = false;
  obdDisconnect();
  setConnected(false);
  setStatus('Desligado', 'off');
}

obd.onDisconnect = () => {
  ui.wantLive = false;
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
  if (on) renderAdapterInfo();
  // A lista de dados disponíveis depende do carro: ajusta e volta a desenhar
  if (on) autoAdaptDashes();
  renderDash();
  renderSensors();
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
  // Se abriu o Painel ou os Sensores durante uma leitura, começa agora a atualizar
  if (ui.wantLive) {
    ui.wantLive = false;
    startLive();
  }
}

// ---- AVARIAS ----
function readDtcs() { return run(doReadDtcs); }

async function doReadDtcs() {
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
}

function clearDtcs() {
  if ((live.values.speed ?? 0) > 0) { showToast('⚠️ Pare o carro antes de apagar avarias'); return; }
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

// ---- ADAPTADOR E CALIBRAÇÃO ----
function renderAdapterInfo() {
  $('info-adapter').innerHTML = infoRows([
    ['Adaptador', escapeHtml(obd.device?.name || '—')],
    ['Versão ELM', escapeHtml(obd.elm || '—')],
    ['Protocolo', escapeHtml(obd.protocol || '—')],
    ['PIDs suportados', obd.supported.size ? [...obd.supported].map(p => p.toString(16).toUpperCase().padStart(2, '0')).join(' ') : '—'],
    ['Pressão atmosférica', baroEst ? `${fmt(baroEst, 2)} bar <span class="text-muted">(medida com o motor desligado)</span>` : '<span class="text-muted">por medir: ligue com o motor desligado</span>'],
    ['Ajuste da tensão', voltAdj ? `${voltAdj > 0 ? '+' : ''}${fmt(voltAdj, 2)} V` : '<span class="text-muted">sem ajuste</span>']
  ]);
}

// Calibra a tensão do adaptador com o valor de um multímetro
function openVoltCal() {
  return run(async () => {
    const raw = atrvRaw(await obdSend('ATRV', 2000));
    if (raw === null) { showToast('⚠️ O adaptador não respondeu'); return; }
    openModal('Calibrar tensão', `
      <div class="text-sm" style="line-height:1.5">Meça a tensão nos terminais da bateria com um multímetro, <strong>ao mesmo tempo</strong> que lê aqui o adaptador (motor desligado ou a trabalhar, tanto faz).</div>
      <div class="info-row mt-12"><span class="text-muted">O adaptador mede agora</span><span class="info-val"><strong>${fmt(raw, 2)} V</strong></span></div>
      <label class="form-label mt-12">Valor do multímetro (V)</label>
      <input id="volt-real" class="form-input" type="text" inputmode="decimal" autocomplete="off" placeholder="Ex.: 14,2">
      <div class="btn-row mt-12">
        <button class="btn btn-outline" onclick="setVoltAdj(0);closeModal();renderAdapterInfo();showToast('Ajuste removido')">Sem ajuste</button>
        <button class="btn btn-primary" onclick="saveVoltCal(${raw})">Guardar</button>
      </div>`);
  });
}

function saveVoltCal(raw) {
  const real = parseFloat($('volt-real').value.replace(',', '.'));
  if (isNaN(real) || real < 9 || real > 17) { showToast('⚠️ Valor inválido'); return; }
  const adj = real - raw;
  if (Math.abs(adj) > 2) { showToast('⚠️ Diferença de mais de 2 V: confirme a medição'); return; }
  setVoltAdj(adj);
  closeModal();
  renderAdapterInfo();
  showToast(`✅ Tensão ajustada em ${adj > 0 ? '+' : ''}${fmt(adj, 2)} V`);
}

// ---- CARRO ----
function readCarInfo() { return run(doReadCarInfo); }

async function doReadCarInfo() {
  const vin = await obdReadVin();
  const dist = await obdReadDistances();
  ui.lastInfo = { vin, ...dist };
  $('info-car').innerHTML = infoRows([
    ['VIN', vin ? `<span class="mono">${vin}</span>` : '<span class="text-muted">não enviado pelo carro</span>'],
    ['Conta-km (PID A6)', dist.odometer !== undefined ? `<strong>${fmt(dist.odometer)} km</strong>` : '<span class="warn-text">não disponível</span>'],
    ['Desde a última limpeza de avarias', dist.sinceClear !== undefined ? fmt(dist.sinceClear) + ' km' : '—'],
    ['Com a luz do motor acesa', dist.withMil !== undefined ? fmt(dist.withMil) + ' km' : '—']
  ]) + (dist.odometer === undefined ? '<div class="text-muted text-sm mt-8">O Mégane III de 2010 normalmente não envia o conta-km pelo OBD standard. Veja-o no quadrante.</div>' : '');
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
  const r = ui.lastReadiness;
  if (r) L.push('Testes da centralina por concluir: ' + (r.tests.filter(t => t.state !== 'ok').map(t => t.name).join(', ') || 'nenhum'));
  const v = ui.lastLive;
  if (v && Object.keys(v).length) {
    L.push('');
    L.push('Últimos valores:');
    for (const p of PIDS) if (v[p.key] !== undefined) L.push(`- ${p.name}: ${fmtValue(p.key, v[p.key])}`);
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
  $('app-version').textContent = APP_VERSION;
  checkForUpdate();
});

// O browser pode guardar a página até 10 min. Se o servidor tiver uma versão mais nova,
// recarrega com ?v=N para obrigar a ir buscar os ficheiros novos (o endereço guardado não muda).
async function checkForUpdate() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    const { v } = await r.json();
    if (!(v > APP_VERSION)) return;
    const key = 'obd-megane3-tentou-v' + v;
    if (sessionStorage.getItem(key)) return; // evita recarregar em ciclo
    sessionStorage.setItem(key, '1');
    if (obdIsConnected()) { showToast('Há uma versão nova da app. Desligue e volte a abrir para atualizar.', 5000); return; }
    location.replace(location.pathname + '?v=' + v);
  } catch {}
}
