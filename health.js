// ============================================================
//  Saúde do carro: testes da centralina, verificação rápida
//  e testes guiados (bateria, alternador, turbo).
//  Os limites são referências gerais, não valores de fábrica.
// ============================================================

const sleep = ms => new Promise(r => setTimeout(r, ms));
const STATE_ICON = { ok: '✓', warn: '!', bad: '✗', info: 'i' };

// ---- TESTES DA CENTRALINA (PID 01) ----
function readReadiness() { return run(doReadReadiness); }

async function doReadReadiness() {
  const b = await obdPid(0x01).catch(() => null);
  const r = parseReadiness(b);
  ui.lastReadiness = r;
  if (!r) { $('readiness').innerHTML = '<span class="text-muted text-sm">O carro não enviou esta informação.</span>'; return; }
  const done = r.tests.filter(t => t.state === 'ok').length;
  $('readiness').innerHTML =
    `<div class="text-sm" style="margin-bottom:8px">${done} de ${r.tests.length} testes concluídos${r.diesel ? ' (motor diesel)' : ''}</div>` +
    r.tests.map(t => `<div class="check-row ${t.state === 'ok' ? 'ok' : 'warn'}"><span class="check-dot">${t.state === 'ok' ? '✓' : '…'}</span><span class="check-name">${t.name}</span><span class="check-state">${t.state === 'ok' ? 'Concluído' : 'Por concluir'}</span></div>`).join('');
}

// ---- VERIFICAÇÃO RÁPIDA ----
const CHECK_KEYS = ['battery', 'ecuVolt', 'rpm', 'speed', 'coolant', 'oil', 'iat', 'ambient', 'map', 'baro', 'boostCmd', 'boostAct', 'maf', 'egrErr', 'dpfDp', 'rail', 'runTime', 'pedal'];

function quickCheck() {
  return run(async () => {
    $('check-result').innerHTML = '<span class="text-muted text-sm">A ler…</span>';
    const v = await readValues(CHECK_KEYS);
    Object.entries(v).forEach(([k, x]) => onLiveValue(k, x));
    const groups = evaluateHealth(v);
    $('check-result').innerHTML = groups.map(([title, items]) => items.length
      ? `<div class="check-group">${title}</div>` + items.map(i =>
          `<div class="check-row ${i.s}"><span class="check-dot">${STATE_ICON[i.s]}</span><div class="check-text"><div>${i.t}</div>${i.d ? `<div class="text-muted text-sm">${i.d}</div>` : ''}</div></div>`).join('')
      : '').join('') || '<span class="text-muted text-sm">O carro não enviou dados suficientes.</span>';
    $('check-time').textContent = 'Verificado às ' + new Date().toLocaleTimeString('pt-PT') + ((v.rpm ?? 0) > 400 ? ' · motor a trabalhar' : ' · motor desligado');
  });
}

// Regras simples sobre os valores lidos. s: ok | warn | bad | info
function evaluateHealth(v) {
  const has = k => v[k] !== undefined && v[k] !== null;
  const running = (v.rpm ?? 0) > 400;
  const idle = running && v.rpm < 1300 && (v.pedal ?? 0) < 5;
  const F = (k, x) => fmtValue(k, x);
  const elec = [], cool = [], turbo = [], engine = [], emis = [], fuel = [], dtc = [];

  // Parte elétrica
  if (has('battery')) {
    const b = v.battery;
    if (!running) {
      if (b >= 12.4) elec.push({ s: 'ok', t: `Bateria em repouso: ${F('battery', b)} (boa)`, d: 'Se o motor esteve ligado há pouco, o valor pode ficar um pouco mais alto durante uns minutos.' });
      else if (b >= 12.0) elec.push({ s: 'warn', t: `Bateria em repouso: ${F('battery', b)} (meio descarregada)`, d: 'Carregue a bateria ou faça um percurso mais longo. Se se repetir, teste a bateria no arranque.' });
      else elec.push({ s: 'bad', t: `Bateria em repouso: ${F('battery', b)} (fraca)`, d: 'Pode falhar o arranque, sobretudo com frio. Carregue-a e faça o teste no arranque.' });
    } else {
      if (b > 15.0) elec.push({ s: 'bad', t: `Carga: ${F('battery', b)} (demasiado alta)`, d: 'Possível avaria no regulador do alternador.' });
      else if (b >= 13.5) elec.push({ s: 'ok', t: `Alternador a carregar: ${F('battery', b)}`, d: 'Normal entre 13,5 e 14,8 V.' });
      else if (b >= 13.0) elec.push({ s: 'warn', t: `Carga baixa: ${F('battery', b)}`, d: 'Faça o teste do alternador com consumos ligados.' });
      else elec.push({ s: 'bad', t: `O alternador não está a carregar: ${F('battery', b)}`, d: 'Verifique a correia e o alternador.' });
    }
    if (has('ecuVolt')) {
      const diff = Math.abs(v.ecuVolt - b);
      if (diff > 0.8) elec.push({ s: 'warn', t: `Diferença de ${fmt(diff, 1)} V entre a tomada OBD e a centralina`, d: 'Verifique os terminais da bateria e as ligações à massa.' });
      else elec.push({ s: 'ok', t: 'Tensão na centralina coerente com a bateria' });
    }
  }

  // Arrefecimento
  if (has('coolant')) {
    const c = v.coolant;
    if (c > 105) cool.push({ s: 'bad', t: `Motor quente demais: ${F('coolant', c)}`, d: 'Desligue o motor e verifique o líquido de refrigeração e a ventoinha.' });
    else if (running && (v.runTime ?? 0) > 900 && c < 70) cool.push({ s: 'warn', t: `Motor demora a aquecer: ${F('coolant', c)} ao fim de ${fmtValue('runTime', v.runTime)}`, d: 'Possível termóstato preso aberto (avaria P0128).' });
    else if (running && c >= 75) cool.push({ s: 'ok', t: `Temperatura do motor normal: ${F('coolant', c)}` });
    else cool.push({ s: 'info', t: `Temperatura do motor: ${F('coolant', c)} (motor frio)` });
    if (!running && c < 45 && has('iat')) {
      const temps = [c, v.iat, v.ambient].filter(x => x !== undefined);
      const spread = Math.max(...temps) - Math.min(...temps);
      if (spread <= 8) cool.push({ s: 'ok', t: 'Sensores de temperatura coerentes entre si' });
      else cool.push({ s: 'warn', t: `Sensores de temperatura com ${fmt(spread)} °C de diferença`, d: 'Só conta se o carro esteve parado várias horas: nesse caso, um dos sensores pode estar errado.' });
    }
  }
  if (has('oil') && v.oil > 130) cool.push({ s: 'bad', t: `Óleo muito quente: ${F('oil', v.oil)}` });

  // Turbo e admissão
  if (has('map')) {
    const baro = baroRef(v);
    const diff = v.map - baro;
    if (!running && has('baro')) {
      if (Math.abs(diff) <= 0.05) turbo.push({ s: 'ok', t: 'Sensor de pressão do turbo coerente (motor desligado)', d: `Mede ${F('map', v.map)}, igual à pressão atmosférica.` });
      else turbo.push({ s: 'warn', t: `Sensor de pressão do turbo com desvio de ${fmt(Math.abs(diff), 2)} bar (motor desligado)`, d: 'Com o motor parado devia medir a pressão atmosférica. Possível sensor (MAP) sujo ou avariado.' });
    } else if (!running) {
      // sem PID 33: só dá para ver se o valor é uma pressão atmosférica plausível (do mar até ~1500 m)
      if (v.map >= 0.83 && v.map <= 1.08) turbo.push({ s: 'ok', t: `Sensor de pressão do turbo plausível (motor desligado): ${F('map', v.map)}`, d: 'Com o motor parado mede a pressão atmosférica. A app guarda este valor para calcular a pressão do turbo.' });
      else turbo.push({ s: 'warn', t: `Sensor de pressão do turbo marca ${F('map', v.map)} com o motor desligado`, d: 'Devia marcar a pressão atmosférica (cerca de 1 bar). Possível sensor (MAP) sujo ou avariado.' });
    } else if (idle) {
      if (diff <= 0.2) turbo.push({ s: 'ok', t: `Pressão em ralenti normal: ${fmt(diff, 2)} bar` });
      else turbo.push({ s: 'warn', t: `Pressão alta em ralenti: ${fmt(diff, 2)} bar`, d: 'Em ralenti o turbo quase não devia dar pressão.' });
    }
  }
  if (running && has('boostCmd') && has('boostAct')) {
    const d = v.boostAct - v.boostCmd;
    if (Math.abs(d) <= 0.15) turbo.push({ s: 'ok', t: 'O turbo segue a pressão pedida pela centralina', d: `Pedida ${F('boostCmd', v.boostCmd)}, medida ${F('boostAct', v.boostAct)}.` });
    else if (d < 0) turbo.push({ s: 'warn', t: `Turbo abaixo do pedido (${fmt(d, 2)} bar)`, d: 'Possível fuga num tubo do intercooler, geometria variável presa ou válvula de comando do turbo.' });
    else turbo.push({ s: 'warn', t: `Turbo acima do pedido (+${fmt(d, 2)} bar)`, d: 'Possível geometria variável presa (sobrepressão).' });
  }
  if (running && has('maf')) {
    if (v.maf < 1) turbo.push({ s: 'bad', t: 'Debitómetro sem sinal com o motor a trabalhar', d: 'Verifique a ficha do debitómetro (medidor de massa de ar).' });
    else turbo.push({ s: 'info', t: `Caudal de ar: ${F('maf', v.maf)}`, d: 'Use o teste do turbo (em baixo) para ver se aumenta com as rotações.' });
  }

  // Motor
  if (idle && (v.coolant ?? 0) >= 70) {
    if (v.rpm >= 700 && v.rpm <= 950) engine.push({ s: 'ok', t: `Ralenti normal: ${F('rpm', v.rpm)}` });
    else engine.push({ s: 'warn', t: `Ralenti fora do habitual: ${F('rpm', v.rpm)}`, d: 'Com o motor quente costuma andar perto das 800 rpm.' });
  }
  if ((v.speed ?? 0) > 0) engine.push({ s: 'warn', t: 'O carro está em movimento', d: 'Esta verificação é feita para o carro parado; em andamento use o Modo condução no Painel.' });

  // Emissões
  if (running && has('egrErr')) {
    if (Math.abs(v.egrErr) <= 10) emis.push({ s: 'ok', t: `EGR segue o comando (erro ${F('egrErr', v.egrErr)})` });
    else emis.push({ s: 'warn', t: `EGR não segue o comando (erro ${F('egrErr', v.egrErr)})`, d: 'Possível válvula EGR suja ou presa.' });
  }
  if (has('dpfDp')) {
    if (!running) {
      if (Math.abs(v.dpfDp) <= 10) emis.push({ s: 'ok', t: 'Sensor de pressão do FAP coerente (motor desligado)' });
      else emis.push({ s: 'warn', t: `Sensor de pressão do FAP marca ${F('dpfDp', v.dpfDp)} com o motor desligado`, d: 'Devia marcar perto de zero. Possível sensor ou tubos do sensor (avarias P2452 a P2455).' });
    } else if (idle) {
      if (v.dpfDp <= 50) emis.push({ s: 'ok', t: `Pressão no FAP em ralenti: ${F('dpfDp', v.dpfDp)}` });
      else emis.push({ s: 'warn', t: `Pressão no FAP alta em ralenti: ${F('dpfDp', v.dpfDp)}`, d: 'Referência aproximada. Pode indicar FAP carregado: um percurso de 20 min em autoestrada ajuda a regenerar.' });
    }
  }

  // Combustível
  if (has('rail')) fuel.push({ s: 'info', t: `Pressão do rail: ${F('rail', v.rail)}`, d: running ? '' : 'Com o motor desligado é normal estar perto de zero.' });

  // Avarias
  const d = ui.lastDtcs;
  if (d) {
    const n = d.stored.length + d.pending.length;
    if (!n) dtc.push({ s: 'ok', t: 'Sem códigos de avaria' });
    else dtc.push({ s: 'warn', t: `${n} código(s) de avaria: ${[...new Set([...d.stored, ...d.pending])].join(', ')}`, d: 'Veja o separador Avarias.' });
  }

  return [['Parte elétrica', elec], ['Arrefecimento', cool], ['Turbo e admissão', turbo], ['Motor', engine], ['Emissões (EGR e FAP)', emis], ['Combustível', fuel], ['Avarias', dtc]];
}

// ---- TESTES GUIADOS ----
function testBox(html) { $('test-box').innerHTML = html; $('test-box').style.display = ''; }

function testProgress(title, msg, secs, pct, valueTxt, chart) {
  testBox(`<div class="test-title">${title}</div><div class="test-msg">${msg}</div>
    <div class="test-bar"><div style="width:${Math.round(pct * 100)}%"></div></div>
    <div class="test-now">${valueTxt}</div>${chart || ''}<div class="text-muted text-sm">${secs > 0 ? `Faltam ${Math.ceil(secs)} s` : ''}</div>`);
}

function testResult(title, rows, chart) {
  testBox(`<div class="test-title">${title}</div>${chart || ''}` + rows.map(i =>
    `<div class="check-row ${i.s}"><span class="check-dot">${STATE_ICON[i.s]}</span><div class="check-text"><div>${i.t}</div>${i.d ? `<div class="text-muted text-sm">${i.d}</div>` : ''}</div></div>`).join('') +
    `<button class="btn btn-outline btn-block mt-12" onclick="$('test-box').style.display='none'">Fechar</button>`);
}

// Recolhe a tensão (ATRV) o mais depressa possível durante `secs`
async function sampleVoltage(secs, onSample) {
  const out = [], t0 = Date.now();
  while (Date.now() - t0 < secs * 1000 && obdIsConnected()) {
    const v = atrvVolts(await obdSend('ATRV', 1500).catch(() => ''));
    if (v !== null) { out.push(v); onSample?.(v, (Date.now() - t0) / 1000); }
  }
  return out;
}

// Bateria no arranque: a tensão mínima durante o arranque mostra o estado da bateria
function testCranking() {
  return run(async () => {
    const rpm = (await readValues(['rpm'])).rpm ?? 0;
    if (rpm > 400) { showToast('⚠️ Desligue o motor primeiro (ignição ligada)'); return; }
    if (!confirm('Teste da bateria no arranque\n\nCom a ignição ligada e o motor desligado, toque em OK e ligue o motor nos 15 segundos seguintes.')) return;
    const title = 'Bateria no arranque';
    const vals = await sampleVoltage(15, (v, t) => testProgress(title, '👉 Ligue o motor agora', 15 - t, t / 15, `${fmt(v, 1)} V`));
    if (vals.length < 5) { testResult(title, [{ s: 'bad', t: 'Não consegui ler a tensão' }]); return; }
    const rest = vals.slice(0, 3).reduce((a, b) => a + b) / 3;
    const min = Math.min(...vals), end = vals.slice(-3).reduce((a, b) => a + b) / 3;
    const chart = sparkSvg(vals, { marks: [9.6, 10] });
    if (rest - min < 0.8) { testResult(title, [{ s: 'warn', t: 'Não detetei o arranque', d: 'Repita o teste e ligue o motor logo depois de tocar em OK.' }], chart); return; }
    const rows = [{ s: 'info', t: `Antes do arranque: ${fmt(rest, 1)} V` }];
    if (min >= 10) rows.push({ s: 'ok', t: `Mínimo no arranque: ${fmt(min, 1)} V (bateria boa)` });
    else if (min >= 9.6) rows.push({ s: 'warn', t: `Mínimo no arranque: ${fmt(min, 1)} V (aceitável)`, d: 'A bateria começa a perder força. Atenção nas manhãs frias.' });
    else rows.push({ s: 'bad', t: `Mínimo no arranque: ${fmt(min, 1)} V (bateria fraca)`, d: 'Abaixo de 9,6 V a bateria deve ser testada numa oficina ou substituída.' });
    rows.push(end >= 13.5 ? { s: 'ok', t: `Depois do arranque: ${fmt(end, 1)} V (alternador a carregar)` } : { s: 'warn', t: `Depois do arranque: ${fmt(end, 1)} V`, d: 'Devia subir para 13,5 V ou mais. Faça a verificação rápida com o motor a trabalhar.' });
    rows.push({ s: 'info', t: 'Referência', d: 'Valores com a bateria e o motor à temperatura ambiente. Com muito frio o mínimo é mais baixo.' });
    testResult(title, rows, chart);
  });
}

// Alternador com consumos: a tensão deve manter-se com luzes, desembaciador e ventilação ligados
function testAlternator() {
  return run(async () => {
    const rpm = (await readValues(['rpm'])).rpm ?? 0;
    if (rpm < 400) { showToast('⚠️ Ligue o motor primeiro'); return; }
    const title = 'Alternador com consumos';
    const base = await sampleVoltage(5, (v, t) => testProgress(title, 'A medir sem consumos. Não ligue nada ainda.', 5 - t, t / 10, `${fmt(v, 1)} V`));
    const load = await sampleVoltage(12, (v, t) => testProgress(title, '👉 Ligue agora: luzes (médios), desembaciador traseiro e ventilação no máximo', 12 - t, 0.5 + t / 24, `${fmt(v, 1)} V`));
    if (!base.length || !load.length) { testResult(title, [{ s: 'bad', t: 'Não consegui ler a tensão' }]); return; }
    const avg = a => a.reduce((x, y) => x + y) / a.length;
    const b = avg(base), minL = Math.min(...load.slice(2)), l = avg(load.slice(2));
    const rows = [{ s: b >= 13.5 && b <= 14.8 ? 'ok' : 'warn', t: `Sem consumos: ${fmt(b, 1)} V` }];
    if (minL >= 13.2) rows.push({ s: 'ok', t: `Com consumos: ${fmt(l, 1)} V (mínimo ${fmt(minL, 1)} V)`, d: 'O alternador aguenta bem a carga.' });
    else if (minL >= 12.8) rows.push({ s: 'warn', t: `Com consumos: ${fmt(l, 1)} V (mínimo ${fmt(minL, 1)} V)`, d: 'Um pouco baixo. Verifique a correia; em ralenti pode ser normal descer um pouco.' });
    else rows.push({ s: 'bad', t: `Com consumos: ${fmt(l, 1)} V (mínimo ${fmt(minL, 1)} V)`, d: 'O alternador não aguenta a carga. Verifique a correia e o alternador.' });
    rows.push({ s: 'info', t: 'Pode desligar os consumos.' });
    testResult(title, rows, sparkSvg([...base, ...load], { marks: [13.2] }));
  });
}

// Resposta do turbo e do debitómetro com o carro parado (acelerar em ponto morto)
function testTurbo() {
  return run(async () => {
    const first = await readValues(['rpm', 'coolant']);
    if ((first.rpm ?? 0) < 400) { showToast('⚠️ Ligue o motor primeiro'); return; }
    if ((first.coolant ?? 0) < 60 && !confirm('O motor ainda está frio. É melhor fazer este teste com o motor quente. Continuar mesmo assim?')) return;
    const title = 'Resposta do turbo (parado)';
    const keys = ['rpm', 'map', 'baro', 'maf', 'boostCmd', 'boostAct', 'speed'];
    const samples = [], t0 = Date.now(), dur = 20;
    while ((Date.now() - t0) / 1000 < dur && obdIsConnected()) {
      const v = await readValues(keys);
      if ((v.speed ?? 0) > 0) { testResult(title, [{ s: 'bad', t: 'O carro está em movimento. Teste cancelado.' }]); return; }
      samples.push(v);
      const t = (Date.now() - t0) / 1000;
      const msg = t < 4 ? 'Em ponto morto, mantenha o motor em ralenti…' : '👉 Acelere e mantenha perto das 2500 rpm (ponto morto, travão de mão puxado)';
      testProgress(title, msg, dur - t, t / dur, `${fmtValue('rpm', v.rpm)} · turbo ${v.map !== undefined ? fmt(v.map - baroRef(v), 2) + ' bar' : '—'} · ar ${fmtValue('maf', v.maf)}`);
    }
    const idleS = samples.filter(s => (s.rpm ?? 0) < 1100);
    const highS = samples.filter(s => (s.rpm ?? 0) >= 2000);
    if (!highS.length) { testResult(title, [{ s: 'warn', t: 'Não detetei aceleração acima das 2000 rpm', d: 'Repita e mantenha as rotações perto das 2500 durante uns segundos.' }]); return; }
    const avg = (a, k) => { const x = a.map(s => s[k]).filter(v => v !== undefined); return x.length ? x.reduce((p, q) => p + q) / x.length : undefined; };
    const rows = [];
    const mafIdle = avg(idleS, 'maf'), mafHigh = Math.max(...highS.map(s => s.maf ?? 0));
    if (mafIdle !== undefined && mafHigh > 0) {
      rows.push(mafHigh >= mafIdle * 1.8
        ? { s: 'ok', t: `O caudal de ar aumenta com as rotações (${fmt(mafIdle, 1)} → ${fmt(mafHigh, 1)} g/s)`, d: 'Debitómetro e admissão a responder.' }
        : { s: 'warn', t: `O caudal de ar aumenta pouco (${fmt(mafIdle, 1)} → ${fmt(mafHigh, 1)} g/s)`, d: 'Possível debitómetro sujo/avariado ou filtro de ar entupido.' });
    }
    const boosts = highS.map(s => s.map !== undefined ? s.map - baroRef(s) : undefined).filter(x => x !== undefined);
    if (boosts.length) rows.push({ s: 'info', t: `Pressão máxima do turbo: ${fmt(Math.max(...boosts), 2)} bar`, d: 'Sem carga é normal o turbo subir pouco (cerca de 0,1 a 0,4 bar). Para avaliar a pressão máxima é preciso um registo em andamento, com outra pessoa a conduzir.' });
    const devs = highS.filter(s => s.boostCmd !== undefined && s.boostAct !== undefined).map(s => s.boostAct - s.boostCmd);
    if (devs.length) {
      const worst = devs.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a);
      rows.push(Math.abs(worst) <= 0.15
        ? { s: 'ok', t: 'O turbo seguiu a pressão pedida pela centralina' }
        : { s: 'warn', t: `Diferença entre pedido e medido: ${fmt(worst, 2)} bar`, d: worst < 0 ? 'Abaixo do pedido: possível fuga de ar ou geometria variável presa.' : 'Acima do pedido: possível geometria variável presa.' });
    }
    testResult(title, rows, sparkSvg(samples.map(s => s.map !== undefined ? s.map - baroRef(s) : 0)));
  });
}
