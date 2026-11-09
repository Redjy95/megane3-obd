// ============================================================
//  Modo condução: ecrã simples para usar num suporte, sem mexer
//  no telemóvel. Grava a viagem e analisa-a no fim (parado).
// ============================================================

const drive = { on: false, keys: [], prevScreen: 'painel', audio: null, lastBeep: {}, armedExit: false, noWake: false };

// Dados gravados sempre (para a análise da viagem), além dos que aparecem no ecrã
const DRIVE_EXTRA = ['speed', 'rpm', 'load', 'pedal', 'map', 'baro', 'boostCmd', 'boostAct', 'maf', 'coolant', 'battery'];

function driveKeys() {
  return [...new Set([...drive.keys, ...DRIVE_EXTRA])].filter(k => pidAvailable(k));
}

function openDriveSetup() {
  if (!obdIsConnected()) { showToast('⚠️ Ligue primeiro ao adaptador'); return; }
  const shown = [...new Set(curDash().widgets.map(w => w.key))].filter(k => pidAvailable(k)).slice(0, 4);
  openModal('Modo condução', `
    <div class="warning-box">⚠️ Não mexa no telemóvel enquanto conduz. Prepare tudo antes de arrancar, com o telemóvel num suporte, ou peça a um passageiro.</div>
    <div class="text-sm" style="line-height:1.5">
      Vai mostrar em grande os primeiros 4 dados do painel <strong>${escapeHtml(curDash().name)}</strong>:
      <div class="mt-8">${shown.map(k => `<span class="hist-tag" style="margin:0 6px 6px 0;display:inline-block">${escapeHtml(PID_BY_KEY[k].short || PID_BY_KEY[k].name)}</span>`).join('') || '<span class="text-muted">(painel vazio)</span>'}</div>
      <div class="text-muted mt-8">Para escolher outros, mude a ordem nesse painel (✎ Editar). Um dado fora dos limites de alerta fica vermelho e dá um sinal sonoro.</div>
      <div class="text-muted mt-8">A viagem fica gravada. No fim, já parado, toque em <strong>Terminar</strong> para ver a análise (turbo em carga, temperaturas, bateria).</div>
      <div class="text-muted mt-8">📱 A app mantém o ecrã ligado enquanto estiver em modo condução. Deixe o telemóvel a carregar.</div>
    </div>
    <button class="btn btn-primary btn-block mt-12" onclick="startDrive()">Começar</button>`);
}

async function startDrive() {
  // tem de ser a primeira coisa, ainda dentro do toque em "Começar"
  const awake = keepAwakeOn();
  closeModal();
  drive.keys = [...new Set(curDash().widgets.map(w => w.key))].filter(k => pidAvailable(k)).slice(0, 4);
  if (!drive.keys.length) drive.keys = ['rpm', 'coolant', 'boost', 'battery'].filter(k => pidAvailable(k));
  drive.on = true;
  drive.armedExit = false;
  drive.prevScreen = ui.screen;
  // o som só funciona se for ativado por um toque (este)
  try { drive.audio = drive.audio || new (window.AudioContext || window.webkitAudioContext)(); drive.audio.resume(); } catch {}
  $('drive').innerHTML = `
    <div class="drive-top"><span class="live-state"></span><span id="drive-rec" class="text-muted text-sm"></span></div>
    <div class="drive-grid">${drive.keys.map(k => `<div class="drive-tile" data-live="${k}" data-drive="1"><div class="drive-lbl">${escapeHtml(PID_BY_KEY[k].short || PID_BY_KEY[k].name)}</div><div class="drive-val">—</div><div class="drive-unit">${escapeHtml(PID_BY_KEY[k].unit)}</div></div>`).join('')}</div>
    <div id="drive-note" class="text-muted text-sm" style="text-align:center"></div>
    <button class="btn btn-outline btn-block drive-exit" id="drive-exit" onclick="exitDrive()">Terminar (com o carro parado)</button>`;
  $('drive').classList.add('open');
  document.body.style.overflow = 'hidden';
  ui.screen = 'conducao';
  live.paused = false;
  live.rec = { start: Date.now(), rows: [] };
  startLive();
  awake.then(m => {
    if (!drive.on) return;
    obdLog('Ecrã ligado: ' + (m || 'não foi possível'));
    $('drive-note').textContent = m ? '' : 'Não consegui manter o ecrã ligado: em Definições → Ecrã e brilho → Bloqueio automático, escolha “Nunca” durante a viagem.';
  });
}

function updateDriveTile(el, key, v) {
  const w = curDash().widgets.find(x => x.key === key) || { key };
  const alert = isAlert(w, v);
  el.classList.toggle('alert', alert);
  el.querySelector('.drive-val').textContent = fmtValue(key, v, false);
  if (alert) beepOnce(key);
  const rec = $('drive-rec');
  if (rec && live.rec) rec.textContent = `● a gravar · ${fmtValue('runTime', (Date.now() - live.rec.start) / 1000)}`;
}

// Sinal sonoro curto, no máximo um a cada 30 s por dado
function beepOnce(key) {
  const now = Date.now();
  if (!drive.audio || now - (drive.lastBeep[key] || 0) < 30000) return;
  drive.lastBeep[key] = now;
  try {
    const o = drive.audio.createOscillator(), g = drive.audio.createGain();
    o.frequency.value = 880; g.gain.value = 0.15;
    o.connect(g); g.connect(drive.audio.destination);
    o.start(); o.stop(drive.audio.currentTime + 0.35);
  } catch {}
}

// Terminar pede dois toques (evita toques sem querer)
function exitDrive() {
  if (obdIsConnected() && (live.values.speed ?? 0) > 3) { showToast('Pare o carro antes de terminar'); return; }
  if (!drive.armedExit) {
    drive.armedExit = true;
    $('drive-exit').textContent = 'Toque outra vez para terminar';
    setTimeout(() => { drive.armedExit = false; const b = $('drive-exit'); if (b) b.textContent = 'Terminar (com o carro parado)'; }, 3000);
    return;
  }
  drive.on = false;
  keepAwakeOff();
  $('drive').classList.remove('open');
  document.body.style.overflow = '';
  const rec = live.rec;
  live.rec = null;
  navigateTo(drive.prevScreen === 'conducao' ? 'painel' : drive.prevScreen);
  if (rec && rec.rows.length > 5) {
    ui.lastTrip = rec;
    showTripAnalysis(rec);
  } else showToast('Viagem demasiado curta para analisar');
}

// ---- ANÁLISE DA VIAGEM ----
function analyzeTrip(rows) {
  const out = [];
  const has = k => rows.some(r => r[k] !== undefined);
  const vals = k => rows.map(r => r[k]).filter(v => v !== undefined);
  const dur = rows[rows.length - 1].t;
  // distância: integra a velocidade
  let dist = 0;
  for (let i = 1; i < rows.length; i++) dist += ((rows[i].speed ?? 0) * (rows[i].t - rows[i - 1].t)) / 3600;
  out.push({ g: 'Viagem', s: 'info', t: `${fmtValue('runTime', dur)} · ${fmt(dist, 1)} km` + (has('speed') ? ` · máx ${fmt(Math.max(...vals('speed')))} km/h` : '') + (has('rpm') ? ` · máx ${fmt(Math.max(...vals('rpm')))} rpm` : '') });

  // Turbo em carga
  const boostOf = r => r.map !== undefined ? r.map - baroRef(r) : undefined;
  const loaded = rows.filter(r => ((r.load ?? 0) >= 80 || (r.pedal ?? 0) >= 80) && (r.rpm ?? 0) >= 1800);
  if (has('map')) {
    const allMax = Math.max(...rows.map(boostOf).filter(v => v !== undefined));
    if (!loaded.length) out.push({ g: 'Turbo', s: 'info', t: `Pressão máxima do turbo: ${fmt(allMax, 2)} bar`, d: 'Não houve acelerações a fundo acima das 1800 rpm. Para avaliar o turbo, acelere a fundo em 3.ª ou 4.ª, numa estrada segura, desde as 1500 até às 3500 rpm.' });
    else {
      const maxL = Math.max(...loaded.map(boostOf).filter(v => v !== undefined));
      out.push({ g: 'Turbo', s: maxL >= 0.9 ? 'ok' : 'warn', t: `Pressão máxima em carga: ${fmt(maxL, 2)} bar`, d: maxL >= 0.9 ? 'Valor habitual para este motor em plena carga (referência aproximada).' : 'Baixa para plena carga (referência aproximada: costuma passar de 1 bar). Possível fuga num tubo do intercooler, geometria variável presa ou válvula de comando do turbo.' });
    }
  }
  const both = loaded.filter(r => r.boostCmd !== undefined && r.boostAct !== undefined);
  if (both.length >= 3) {
    // quedas abaixo do pedido durante 3 leituras seguidas
    let run = 0, worstRun = 0;
    for (const r of both) { run = (r.boostAct - r.boostCmd) < -0.2 ? run + 1 : 0; worstRun = Math.max(worstRun, run); }
    const avgDev = both.reduce((a, r) => a + (r.boostAct - r.boostCmd), 0) / both.length;
    if (worstRun >= 3) out.push({ g: 'Turbo', s: 'warn', t: `Turbo abaixo do pedido em carga (em média ${fmt(avgDev, 2)} bar)`, d: 'A pressão medida ficou mais de 0,2 bar abaixo da pedida durante vários segundos: sinal de fuga de ar, geometria variável presa ou válvula de comando.' });
    else out.push({ g: 'Turbo', s: 'ok', t: 'O turbo seguiu a pressão pedida em carga', d: `Diferença média ${fmt(avgDev, 2)} bar.` });
  }
  if (has('maf') && loaded.length) out.push({ g: 'Turbo', s: 'info', t: `Caudal de ar máximo: ${fmt(Math.max(...loaded.map(r => r.maf ?? 0)), 1)} g/s` });

  // Temperaturas
  if (has('coolant')) {
    const c = vals('coolant'), max = Math.max(...c);
    if (max > 105) out.push({ g: 'Arrefecimento', s: 'bad', t: `Temperatura do motor chegou a ${fmt(max)} °C`, d: 'Verifique o líquido de refrigeração e a ventoinha.' });
    else if (dur > 900 && max < 75) out.push({ g: 'Arrefecimento', s: 'warn', t: `O motor não passou dos ${fmt(max)} °C em ${fmtValue('runTime', dur)}`, d: 'Possível termóstato preso aberto (avaria P0128).' });
    else out.push({ g: 'Arrefecimento', s: 'ok', t: `Temperatura máxima do motor: ${fmt(max)} °C` });
  }

  // Parte elétrica (só com o motor a trabalhar)
  const bRun = rows.filter(r => (r.rpm ?? 0) > 400 && r.battery !== undefined).map(r => r.battery);
  if (bRun.length) {
    const lo = Math.min(...bRun), hi = Math.max(...bRun);
    if (hi > 15) out.push({ g: 'Parte elétrica', s: 'bad', t: `Tensão chegou a ${fmt(hi, 1)} V`, d: 'Demasiado alta: possível regulador do alternador.' });
    else if (lo < 13) out.push({ g: 'Parte elétrica', s: 'warn', t: `Tensão desceu a ${fmt(lo, 1)} V com o motor a trabalhar`, d: 'O alternador pode não estar a carregar bem.' });
    else out.push({ g: 'Parte elétrica', s: 'ok', t: `Alternador a carregar: ${fmt(lo, 1)} a ${fmt(hi, 1)} V` });
  }
  return out;
}

function showTripAnalysis(rec) {
  const items = analyzeTrip(rec.rows);
  let lastG = '';
  const html = items.map(i => {
    const head = i.g !== lastG ? `<div class="check-group">${i.g}</div>` : '';
    lastG = i.g;
    return head + `<div class="check-row ${i.s}"><span class="check-dot">${STATE_ICON[i.s]}</span><div class="check-text"><div>${i.t}</div>${i.d ? `<div class="text-muted text-sm">${i.d}</div>` : ''}</div></div>`;
  }).join('');
  const boost = rec.rows.map(r => r.map !== undefined ? r.map - baroRef(r) : null).filter(v => v !== null);
  openModal('Análise da viagem', html +
    (boost.length > 1 ? `<div class="check-group">Pressão do turbo ao longo da viagem</div>${sparkSvg(boost.length > 400 ? boost.filter((_, i) => i % Math.ceil(boost.length / 400) === 0) : boost)}` : '') +
    `<div class="text-muted text-sm mt-8">Referências aproximadas para este tipo de motor, não valores de fábrica.</div>
     <button class="btn btn-primary btn-block mt-12" onclick="shareTrip()">Guardar viagem (CSV)</button>`);
}

function shareTrip() {
  if (!ui.lastTrip) return;
  live.rec = ui.lastTrip;
  finishRecord();
}
