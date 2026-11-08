// ============================================================
//  OBD MÉGANE 3 — comunicação com o ELM327 (Bluetooth LE)
//  Baseado no obd.js da app Check Mégane 3.
//  Funciona no Bluefy (iPhone) e no Chrome (Android).
//  Usar só com o carro parado.
// ============================================================

// Serviços BLE usados pelos adaptadores ELM327 mais comuns
const OBD_SERVICES = [
  0xfff0, 0xffe0, 0x18f0,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2' // Vgate iCar Pro BLE
];

const obd = {
  device: null,
  writeChar: null,
  notifyChar: null,
  buffer: '',
  pending: null,      // { resolve, reject, timer }
  queue: Promise.resolve(),
  supported: new Set(), // PIDs do modo 01 que a centralina diz suportar
  protocol: '',
  elm: '',
  onLog: null,          // função chamada com cada linha do registo
  onDisconnect: null
};

// ---- LIGAÇÃO ----
function obdSupported() {
  return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
}

// Texto legível de um erro (o Bluefy às vezes rejeita com um número ou objeto)
function obdErrText(e) {
  if (e instanceof Error) return (e.name && e.name !== 'Error' ? e.name + ': ' : '') + (e.message || '');
  if (e && typeof e === 'object') { try { return JSON.stringify(e); } catch {} }
  return String(e);
}

const uuidShort = u => String(u).replace(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i, '$1');
const propsText = c => Object.keys({ read: 0, write: 0, writeWithoutResponse: 0, notify: 0, indicate: 0 }).filter(k => c.properties[k]).join(',');

// Liga ao adaptador e inicia o ELM327. onStatus(texto) mostra o progresso.
// Cada passo fica no registo, e o erro diz em que passo falhou.
async function obdConnect(onStatus = () => {}) {
  let step = '';
  const go = (s, status) => { step = s; obdLog('• ' + s); if (status) onStatus(status); };
  try {
    go('Escolher adaptador', 'A procurar adaptador…');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'OBD' }, { namePrefix: 'Vgate' }, { namePrefix: 'IOS-Vlink' }, { namePrefix: 'V-LINK' }, { namePrefix: 'Veepeak' }, { services: [0xfff0] }, { services: [0xffe0] }],
      optionalServices: OBD_SERVICES
    });
    obd.device = device;
    obdLog('Adaptador: ' + (device.name || '(sem nome)'));
    device.addEventListener('gattserverdisconnected', obdOnDisconnect);

    go('Ligar por Bluetooth', 'A ligar a ' + (device.name || 'adaptador') + '…');
    let server;
    try { server = await device.gatt.connect(); }
    catch (e) {
      obdLog('Falhou (' + obdErrText(e) + '). Nova tentativa…');
      await new Promise(r => setTimeout(r, 1500));
      server = await device.gatt.connect();
    }

    go('Ler serviços do adaptador');
    let services = [];
    try { services = await server.getPrimaryServices(); }
    catch (e) { obdLog('Lista de serviços falhou (' + obdErrText(e) + '). A pedir um a um…'); }
    if (!services.length) {
      for (const u of OBD_SERVICES) {
        try { services.push(await server.getPrimaryService(u)); } catch {}
      }
    }

    // Candidatos: primeiro os serviços com envio + receção juntos (ex.: FFF0 → FFF1 + FFF2)
    go('Procurar canal de dados');
    const pairs = [], writes = [], notifies = [];
    for (const service of services) {
      let chars;
      try { chars = await service.getCharacteristics(); }
      catch (e) { obdLog(`Serviço ${uuidShort(service.uuid)}: ${obdErrText(e)}`); continue; }
      obdLog(`Serviço ${uuidShort(service.uuid)}: ` + chars.map(c => `${uuidShort(c.uuid)}[${propsText(c)}]`).join(' '));
      const w = chars.filter(c => c.properties.write || c.properties.writeWithoutResponse);
      const n = chars.filter(c => c.properties.notify || c.properties.indicate);
      if (w.length && n.length) pairs.push({ w: w[0], n: n[0] });
      writes.push(...w); notifies.push(...n);
    }
    if (writes.length && notifies.length) pairs.push({ w: writes[0], n: notifies[0] });
    if (!pairs.length) throw new Error('Adaptador não compatível (sem canal de dados).');

    // Ativa as notificações no primeiro candidato que aceitar
    go('Ativar receção de dados', 'A iniciar o ELM327…');
    let chosen = null, lastErr = null;
    for (const p of pairs) {
      try {
        await p.n.startNotifications();
        chosen = p; break;
      } catch (e) { lastErr = e; obdLog(`Receção em ${uuidShort(p.n.uuid)} falhou: ${obdErrText(e)}`); }
    }
    if (!chosen) throw lastErr || new Error('Sem canal de receção');
    obdLog(`Canal: envio ${uuidShort(chosen.w.uuid)}, receção ${uuidShort(chosen.n.uuid)}`);
    obd.writeChar = chosen.w;
    obd.notifyChar = chosen.n;
    chosen.n.addEventListener('characteristicvaluechanged', obdOnData);

    go('Iniciar o ELM327');
  obd.elm = (await obdSend('ATZ', 4000)).replace(/[\r\n>]+/g, ' ').trim();
  for (const cmd of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATSP0']) await obdSend(cmd, 2000);

  // Primeiro pedido ao carro (pode demorar enquanto procura o protocolo).
  // O Mégane III dCi usa CAN 11 bit 500 kbps (protocolo 6): se o automático falhar, força-o.
  go('Falar com o carro', 'A falar com o carro (pode demorar uns segundos)…');
  let first = await obdSend('0100', 12000).catch(() => '');
  if (!obdBytes(first, 1, 0x00)) {
    obdLog('Protocolo automático falhou. A tentar CAN 11 bit 500 kbps (ATSP6)…');
    await obdSend('ATSP6', 2000);
    first = await obdSend('0100', 8000).catch(() => '');
  }
  if (!obdBytes(first, 1, 0x00)) {
    throw new Error('O carro não respondeu. Confirme que a ignição está ligada.');
  }
  obd.protocol = (await obdSend('ATDP', 2000).catch(() => '')).replace(/^AUTO,\s*/i, '').trim();
  await obdLoadSupported(first);
  return device.name || 'adaptador';
  } catch (e) {
    if (e && e.name === 'NotFoundError') throw e;
    obdLog(`✗ Falhou em "${step}": ${obdErrText(e)}`);
    throw new Error(`Falhou em "${step}": ${obdErrText(e)}`);
  }
}

function obdDisconnect() {
  try { obd.device?.gatt?.connected && obd.device.gatt.disconnect(); } catch {}
  obdOnDisconnect();
}

function obdOnDisconnect() {
  const was = !!obd.writeChar;
  obd.writeChar = null;
  try { obd.notifyChar?.removeEventListener('characteristicvaluechanged', obdOnData); } catch {}
  obd.notifyChar = null;
  if (obd.pending) { clearTimeout(obd.pending.timer); obd.pending.reject(new Error('Ligação perdida')); obd.pending = null; }
  if (was && obd.onDisconnect) obd.onDisconnect();
}

function obdIsConnected() { return !!obd.writeChar; }

// ---- COMUNICAÇÃO ----
function obdOnData(e) {
  obd.buffer += new TextDecoder().decode(e.target.value);
  if (obd.buffer.includes('>') && obd.pending) {
    const text = obd.buffer.slice(0, obd.buffer.indexOf('>')).trim();
    obd.buffer = '';
    clearTimeout(obd.pending.timer);
    const p = obd.pending; obd.pending = null;
    p.resolve(text);
  }
}

// Envia um comando e espera pela resposta (até ao ">" do ELM327). Os comandos ficam em fila.
function obdSend(cmd, timeout = 5000) {
  const run = () => new Promise(async (resolve, reject) => {
    if (!obd.writeChar) return reject(new Error('Não ligado'));
    obd.buffer = '';
    obd.pending = {
      resolve: text => { obdLog(`> ${cmd}\n${text}`); resolve(text); },
      reject,
      timer: setTimeout(() => { obd.pending = null; obdLog(`> ${cmd}\n(sem resposta)`); reject(new Error('Sem resposta do adaptador')); }, timeout)
    };
    try {
      const data = new TextEncoder().encode(cmd + '\r');
      const c = obd.writeChar;
      // O Bluefy nem sempre tem writeValueWithoutResponse: usa writeValue nesse caso.
      // Se um modo de escrita falhar, tenta o outro.
      const noResp = c.properties.writeWithoutResponse && typeof c.writeValueWithoutResponse === 'function';
      const withResp = c.properties.write && typeof c.writeValueWithResponse === 'function';
      try {
        if (noResp) await c.writeValueWithoutResponse(data);
        else await c.writeValue(data);
      } catch (e1) {
        obdLog('Escrita falhou (' + obdErrText(e1) + '). A tentar outro modo…');
        if (noResp && withResp) await c.writeValueWithResponse(data);
        else await c.writeValue(data);
      }
    } catch (err) { clearTimeout(obd.pending?.timer); obd.pending = null; reject(err); }
  });
  const p = obd.queue.then(run, run);
  obd.queue = p.catch(() => {});
  return p;
}

// Linhas úteis de uma resposta (sem "SEARCHING…" e afins)
function obdLines(text) {
  return String(text).split(/[\r\n]+/)
    .map(l => l.trim())
    .filter(l => l && !/SEARCHING|BUS INIT|STOPPED/i.test(l));
}

// Junta as linhas de uma resposta (também multi-trama "0: 1: …") em hex contínuo
function obdCleanHex(text) {
  return obdLines(text)
    .filter((l, idx, arr) => !(arr.length > 1 && idx === 0 && /^[0-9A-F]{3}$/i.test(l))) // comprimento da multi-trama
    .map(l => l.replace(/^[0-9A-F]:/i, ''))
    .join('').replace(/[^0-9A-F]/gi, '').toUpperCase();
}

// Bytes de dados de uma resposta "4M PP ..." (modo M, PID PP opcional), ou null
function obdBytes(text, mode, pid) {
  if (!text) return null;
  const hex = obdCleanHex(text);
  const head = (0x40 + mode).toString(16).toUpperCase() + (pid !== undefined ? pid.toString(16).toUpperCase().padStart(2, '0') : '');
  // procura o cabeçalho numa posição par (alinhado aos bytes)
  let i = hex.indexOf(head);
  while (i >= 0 && i % 2) i = hex.indexOf(head, i + 1);
  if (i < 0) return null;
  const rest = hex.slice(i + head.length);
  const bytes = [];
  for (let j = 0; j + 1 < rest.length; j += 2) bytes.push(parseInt(rest.slice(j, j + 2), 16));
  return bytes;
}

function obdNoData(text) {
  return /NO DATA|ERROR|UNABLE|\?|CAN ERROR|STOPPED/i.test(text);
}

// Lê os PIDs suportados (0100, 0120, 0140, …)
async function obdLoadSupported(first) {
  obd.supported = new Set();
  let resp = first;
  for (let base = 0; base <= 0xa0; base += 0x20) {
    if (base > 0) resp = await obdSend('01' + base.toString(16).toUpperCase().padStart(2, '0'), 3000).catch(() => '');
    const b = obdBytes(resp, 1, base);
    if (!b || b.length < 4) break;
    for (let i = 0; i < 32; i++) {
      if (b[i >> 3] & (0x80 >> (i & 7))) obd.supported.add(base + i + 1);
    }
    if (!obd.supported.has(base + 0x20)) break;
  }
}

function obdHas(pid) { return obd.supported.has(pid); }

// ---- LEITURAS ----

// Pede um PID do modo 01 e devolve os bytes, ou null
async function obdPid(pid, timeout = 3000) {
  const r = await obdSend('01' + pid.toString(16).toUpperCase().padStart(2, '0'), timeout);
  return obdBytes(r, 1, pid);
}

// Fórmulas dos PIDs do modo 01 (SAE J1979)
const OBD_LIVE_PIDS = [
  { pid: 0x05, key: 'coolant',  f: b => b[0] - 40 },
  { pid: 0x0C, key: 'rpm',      f: b => Math.round((b[0] * 256 + b[1]) / 4), n: 2 },
  { pid: 0x0D, key: 'speed',    f: b => b[0] },
  { pid: 0x04, key: 'load',     f: b => Math.round(b[0] * 100 / 255) },
  { pid: 0x0B, key: 'map',      f: b => b[0] },                       // kPa absoluto
  { pid: 0x33, key: 'baro',     f: b => b[0] },                       // kPa
  { pid: 0x0F, key: 'iat',      f: b => b[0] - 40 },
  { pid: 0x10, key: 'maf',      f: b => (b[0] * 256 + b[1]) / 100, n: 2 }, // g/s
  { pid: 0x42, key: 'ecuVolt',  f: b => (b[0] * 256 + b[1]) / 1000, n: 2 },
  { pid: 0x46, key: 'ambient',  f: b => b[0] - 40 },
  { pid: 0x23, key: 'rail',     f: b => (b[0] * 256 + b[1]) * 10, n: 2 }, // kPa
  { pid: 0x2F, key: 'fuel',     f: b => Math.round(b[0] * 100 / 255) }
];

// Lê bateria + PIDs suportados. Devolve { battery, coolant, rpm, … }
async function obdReadLive() {
  const out = {};
  const volt = await obdSend('ATRV', 2000);
  const v = parseFloat(volt.replace(/[^0-9.]/g, ''));
  if (!isNaN(v)) out.battery = v;
  const skipCheck = obd.supported.size === 0; // se a lista falhou, tenta os básicos
  for (const p of OBD_LIVE_PIDS) {
    if (!skipCheck && !obdHas(p.pid)) continue;
    if (skipCheck && ![0x05, 0x0C, 0x0D].includes(p.pid)) continue;
    const b = await obdPid(p.pid).catch(() => null);
    if (b && b.length >= (p.n || 1)) out[p.key] = p.f(b);
  }
  return out;
}

// Estado da luz do motor (PID 01): { mil: bool, count: n }
async function obdReadMilStatus() {
  const b = await obdPid(0x01).catch(() => null);
  if (!b || b.length < 1) return null;
  return { mil: !!(b[0] & 0x80), count: b[0] & 0x7f };
}

// Converte 2 bytes num código (ex.: 0x03 0x80 → P0380)
function obdDtcCode(a, b) {
  return ['P', 'C', 'B', 'U'][a >> 6] + ((a >> 4) & 3) + (a & 15).toString(16).toUpperCase() + b.toString(16).toUpperCase().padStart(2, '0');
}

// Decodifica códigos de avaria (modos 03 / 07 / 0A). CAN: 4M + nº de códigos + 2 bytes por código.
// Se responderem várias centralinas (uma linha cada), junta tudo.
function obdParseDtcs(text, mode = 3) {
  const head = (0x40 + mode).toString(16).toUpperCase();
  if (obdNoData(text) && !new RegExp(head).test(text)) return [];
  const lines = obdLines(text);
  const multiFrame = lines.some(l => /^[0-9A-F]:/i.test(l));
  const chunks = (!multiFrame && lines.filter(l => l.replace(/\s/g, '').toUpperCase().startsWith(head)).length > 1)
    ? lines : [text];
  const codes = [];
  for (const chunk of chunks) {
    const bytes = obdBytes(chunk, mode);
    if (!bytes) continue;
    let data = bytes;
    if (bytes.length % 2 === 1 && bytes[0] * 2 <= bytes.length - 1) data = bytes.slice(1, 1 + bytes[0] * 2);
    for (let i = 0; i + 1 < data.length; i += 2) {
      if (data[i] === 0 && data[i + 1] === 0) continue;
      codes.push(obdDtcCode(data[i], data[i + 1]));
    }
  }
  return [...new Set(codes)];
}

// Lê avarias confirmadas (03) e pendentes (07)
async function obdReadDtcs() {
  const stored = obdParseDtcs(await obdSend('03', 8000), 3);
  const pending = obdParseDtcs(await obdSend('07', 8000).catch(() => ''), 7);
  return { stored, pending };
}

// Apaga as avarias (modo 04). Devolve true se o carro aceitou.
async function obdClearDtcs() {
  const r = await obdSend('04', 8000);
  return /44/.test(obdCleanHex(r));
}

// Dados guardados no momento da avaria (modo 02, trama 0)
async function obdReadFreezeFrame() {
  const pid2 = async pid => {
    const r = await obdSend('02' + pid.toString(16).toUpperCase().padStart(2, '0') + '00', 3000).catch(() => '');
    const b = obdBytes(r, 2, pid);
    return b && b.length >= 2 ? b.slice(1) : null; // salta o nº da trama
  };
  const dtcB = await pid2(0x02);
  if (!dtcB || (dtcB[0] === 0 && dtcB[1] === 0)) return null;
  const out = { dtc: obdDtcCode(dtcB[0], dtcB[1]) };
  for (const p of OBD_LIVE_PIDS.filter(p => [0x05, 0x0C, 0x0D, 0x04, 0x0B, 0x0F].includes(p.pid))) {
    const b = await pid2(p.pid);
    if (b && b.length >= (p.n || 1)) out[p.key] = p.f(b);
  }
  return out;
}

// VIN (modo 09 PID 02). Muitos carros de 2010 não o enviam.
async function obdReadVin() {
  const r = await obdSend('0902', 5000).catch(() => '');
  // Protocolos antigos: uma linha "49 02 nº …" por bloco; CAN: uma multi-trama
  const lines = obdLines(r).filter(l => l.replace(/\s/g, '').toUpperCase().startsWith('4902'));
  const parts = lines.length > 1 ? lines.map(l => (obdBytes(l, 9, 0x02) || []).slice(1)) : [obdBytes(r, 9, 0x02)];
  const b = parts.filter(Boolean).flat();
  if (!b.length) return null;
  const txt = String.fromCharCode(...b.filter(x => x >= 0x30 && x <= 0x5a));
  const m = txt.match(/[A-HJ-NPR-Z0-9]{17}/);
  return m ? m[0] : null;
}

// Tenta ler o conta-km (PID A6) e as distâncias (PIDs 21 e 31)
async function obdReadDistances() {
  const out = {};
  const odo = await obdPid(0xa6).catch(() => null);
  if (odo && odo.length >= 4) out.odometer = Math.round(((odo[0] << 24 >>> 0) + (odo[1] << 16) + (odo[2] << 8) + odo[3]) / 10);
  const mil = await obdPid(0x21).catch(() => null);
  if (mil && mil.length >= 2) out.withMil = mil[0] * 256 + mil[1];
  const clr = await obdPid(0x31).catch(() => null);
  if (clr && clr.length >= 2) out.sinceClear = clr[0] * 256 + clr[1];
  return out;
}

function obdLog(text) {
  if (obd.onLog) obd.onLog(text);
}
