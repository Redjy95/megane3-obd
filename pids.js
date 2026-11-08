// ============================================================
//  Catálogo dos dados OBD (modo 01, SAE J1979) relevantes para
//  o 1.5 dCi. Só aparecem na app os que a centralina suporta.
// ============================================================

const CATS = {
  motor: 'Motor',
  turbo: 'Turbo e admissão',
  comb: 'Combustível e injeção',
  eletr: 'Parte elétrica',
  temp: 'Temperaturas',
  emis: 'Emissões (EGR e FAP)',
  info: 'Contadores'
};

const u16 = b => b[0] * 256 + b[1];

// runTime: o valor é em segundos, mostrado como min:ss
// pid: PID do modo 01 ('RV' = tensão medida pelo adaptador)
// n: nº de bytes; f: fórmula; dec: casas decimais; min/max: escala dos mostradores
// short: nome curto para os mostradores
// warn: limites de alerta por omissão (o utilizador pode mudar em cada painel)
const PIDS = [
  // Parte elétrica
  { key: 'battery', pid: 'RV', name: 'Bateria', unit: 'V', cat: 'eletr', dec: 1, min: 10, max: 16, warn: { lo: 12.0, hi: 15.0 } },
  { key: 'ecuVolt', short: 'Tensão centralina', pid: 0x42, n: 2, f: b => u16(b) / 1000, name: 'Tensão na centralina', unit: 'V', cat: 'eletr', dec: 1, min: 10, max: 16, warn: { lo: 12.0, hi: 15.0 } },

  // Motor
  { key: 'rpm', pid: 0x0C, n: 2, f: b => Math.round(u16(b) / 4), name: 'Rotações', unit: 'rpm', cat: 'motor', dec: 0, min: 0, max: 5000, warn: { hi: 4500 } },
  { key: 'speed', pid: 0x0D, f: b => b[0], name: 'Velocidade', unit: 'km/h', cat: 'motor', dec: 0, min: 0, max: 200 },
  { key: 'load', pid: 0x04, f: b => b[0] * 100 / 255, name: 'Carga do motor', unit: '%', cat: 'motor', dec: 0, min: 0, max: 100 },
  { key: 'absLoad', pid: 0x43, n: 2, f: b => u16(b) * 100 / 255, name: 'Carga absoluta', unit: '%', cat: 'motor', dec: 0, min: 0, max: 100 },
  { key: 'pedal', short: 'Pedal acelerador', pid: 0x49, f: b => b[0] * 100 / 255, name: 'Pedal do acelerador', unit: '%', cat: 'motor', dec: 0, min: 0, max: 100 },
  { key: 'throttle', short: 'Borboleta', pid: 0x11, f: b => b[0] * 100 / 255, name: 'Borboleta de admissão', unit: '%', cat: 'motor', dec: 0, min: 0, max: 100 },
  { key: 'cmdThrottle', short: 'Borboleta pedida', pid: 0x4C, f: b => b[0] * 100 / 255, name: 'Borboleta comandada', unit: '%', cat: 'motor', dec: 0, min: 0, max: 100 },
  { key: 'torqueDemand', pid: 0x61, f: b => b[0] - 125, name: 'Binário pedido', unit: '%', cat: 'motor', dec: 0, min: 0, max: 100 },
  { key: 'torque', pid: 0x62, f: b => b[0] - 125, name: 'Binário real', unit: '%', cat: 'motor', dec: 0, min: 0, max: 100 },
  { key: 'torqueRef', short: 'Binário ref.', pid: 0x63, n: 2, f: u16, name: 'Binário de referência', unit: 'Nm', cat: 'motor', dec: 0, min: 0, max: 300 },

  // Temperaturas
  { key: 'coolant', short: 'Temp. motor', pid: 0x05, f: b => b[0] - 40, name: 'Temperatura do motor', unit: '°C', cat: 'temp', dec: 0, min: -20, max: 130, warn: { hi: 105 } },
  { key: 'oil', short: 'Temp. óleo', pid: 0x5C, f: b => b[0] - 40, name: 'Temperatura do óleo', unit: '°C', cat: 'temp', dec: 0, min: -20, max: 150, warn: { hi: 130 } },
  { key: 'iat', short: 'Temp. ar admissão', pid: 0x0F, f: b => b[0] - 40, name: 'Temperatura do ar de admissão', unit: '°C', cat: 'temp', dec: 0, min: -20, max: 80, warn: { hi: 60 } },
  { key: 'ambient', short: 'Temp. exterior', pid: 0x46, f: b => b[0] - 40, name: 'Temperatura exterior', unit: '°C', cat: 'temp', dec: 0, min: -20, max: 50 },

  // Turbo e admissão
  { key: 'boost', derived: ['map'], calc: v => v.map - (v.baro ?? 1.013), name: 'Pressão do turbo', unit: 'bar', cat: 'turbo', dec: 2, min: -0.2, max: 1.6, warn: { hi: 1.5 } },
  { key: 'map', short: 'Pressão coletor', pid: 0x0B, f: b => b[0] / 100, name: 'Pressão no coletor (absoluta)', unit: 'bar', cat: 'turbo', dec: 2, min: 0, max: 2.6 },
  { key: 'baro', short: 'Pressão atmosf.', pid: 0x33, f: b => b[0] / 100, name: 'Pressão atmosférica', unit: 'bar', cat: 'turbo', dec: 2, min: 0.8, max: 1.1 },
  { key: 'boostCmd', short: 'Turbo pedido', pid: 0x70, n: 5, f: b => (b[0] & 1) ? u16(b.slice(1)) * 0.03125 / 100 : null, name: 'Turbo: pressão pedida (absoluta)', unit: 'bar', cat: 'turbo', dec: 2, min: 0, max: 2.6 },
  { key: 'boostAct', short: 'Turbo medido', pid: 0x70, n: 5, f: b => (b[0] & 2) ? u16(b.slice(3)) * 0.03125 / 100 : null, name: 'Turbo: pressão medida (absoluta)', unit: 'bar', cat: 'turbo', dec: 2, min: 0, max: 2.6 },
  { key: 'maf', short: 'Caudal de ar', pid: 0x10, n: 2, f: b => u16(b) / 100, name: 'Caudal de ar (debitómetro)', unit: 'g/s', cat: 'turbo', dec: 1, min: 0, max: 120 },

  // Combustível e injeção
  { key: 'rail', pid: 0x23, n: 2, f: b => u16(b) / 10, name: 'Pressão do rail', unit: 'bar', cat: 'comb', dec: 0, min: 0, max: 1800 },
  { key: 'railRel', short: 'Rail (relativa)', pid: 0x22, n: 2, f: b => u16(b) * 0.079 / 100, name: 'Pressão do rail (relativa)', unit: 'bar', cat: 'comb', dec: 0, min: 0, max: 1800 },
  { key: 'injTiming', short: 'Avanço injeção', pid: 0x5D, n: 2, f: b => u16(b) / 128 - 210, name: 'Avanço da injeção', unit: '°', cat: 'comb', dec: 1, min: -20, max: 40 },
  { key: 'fuelRate', short: 'Consumo', pid: 0x5E, n: 2, f: b => u16(b) / 20, name: 'Consumo instantâneo', unit: 'L/h', cat: 'comb', dec: 1, min: 0, max: 20 },
  { key: 'fuel', short: 'Combustível', pid: 0x2F, f: b => b[0] * 100 / 255, name: 'Nível de combustível', unit: '%', cat: 'comb', dec: 0, min: 0, max: 100, warn: { lo: 10 } },

  // Emissões
  { key: 'egrCmd', pid: 0x2C, f: b => b[0] * 100 / 255, name: 'EGR comandada', unit: '%', cat: 'emis', dec: 0, min: 0, max: 100 },
  { key: 'egrErr', pid: 0x2D, f: b => b[0] * 100 / 128 - 100, name: 'Erro da EGR', unit: '%', cat: 'emis', dec: 0, min: -100, max: 100, warn: { lo: -15, hi: 15 } },
  { key: 'dpfDp', short: 'FAP: Δ pressão', pid: 0x7A, n: 3, f: b => (b[0] & 1) ? (u16(b.slice(1)) << 16 >> 16) * 0.1 : null, name: 'FAP: pressão diferencial', unit: 'mbar', cat: 'emis', dec: 0, min: 0, max: 300 },

  // Contadores
  { key: 'runTime', short: 'Tempo ligado', pid: 0x1F, n: 2, f: u16, name: 'Tempo desde o arranque', unit: 'min', cat: 'info', dec: 0, min: 0, max: 3600 },
  { key: 'distClear', short: 'Km desde limpeza', pid: 0x31, n: 2, f: u16, name: 'Km desde a limpeza de avarias', unit: 'km', cat: 'info', dec: 0, min: 0, max: 65535 },
  { key: 'distMil', short: 'Km luz acesa', pid: 0x21, n: 2, f: u16, name: 'Km com a luz do motor acesa', unit: 'km', cat: 'info', dec: 0, min: 0, max: 65535 },
  { key: 'warmups', short: 'Aquecimentos', pid: 0x30, f: b => b[0], name: 'Aquecimentos desde a limpeza', unit: '', cat: 'info', dec: 0, min: 0, max: 255 },
  { key: 'timeMil', short: 'Min. luz acesa', pid: 0x4D, n: 2, f: u16, name: 'Minutos com a luz acesa', unit: 'min', cat: 'info', dec: 0, min: 0, max: 65535 },
  { key: 'timeClear', short: 'Min. desde limpeza', pid: 0x4E, n: 2, f: u16, name: 'Minutos desde a limpeza', unit: 'min', cat: 'info', dec: 0, min: 0, max: 65535 }
];

const PID_BY_KEY = Object.fromEntries(PIDS.map(p => [p.key, p]));

// PIDs básicos que se tentam mesmo se a lista de suportados falhar
const PID_BASIC = new Set([0x04, 0x05, 0x0B, 0x0C, 0x0D, 0x0F, 0x10]);

// O carro tem este dado?
function pidAvailable(p) {
  if (typeof p === 'string') p = PID_BY_KEY[p];
  if (!p) return false;
  if (p.derived) return p.derived.every(pidAvailable);
  if (p.pid === 'RV') return true;
  if (!obd.supported.size) return PID_BASIC.has(p.pid);
  return obd.supported.has(p.pid);
}

// Lê um conjunto de dados (por chave). Pede cada PID uma só vez.
// onValue(key, valor) é chamado à medida que chegam (para o ecrã atualizar logo);
// shouldStop() permite parar a meio (ex.: ao mudar de separador).
async function readValues(keys, onValue = () => {}, shouldStop = () => false) {
  const want = new Set();
  for (const k of keys) {
    const p = PID_BY_KEY[k];
    if (!p || !pidAvailable(p)) continue;
    if (p.derived) { p.derived.forEach(d => want.add(d)); if (pidAvailable('baro')) want.add('baro'); }
    else want.add(k);
  }
  // agrupa por PID
  const byPid = new Map();
  for (const k of want) {
    const p = PID_BY_KEY[k];
    if (!byPid.has(p.pid)) byPid.set(p.pid, []);
    byPid.get(p.pid).push(p);
  }
  const out = {};
  for (const [pid, list] of byPid) {
    if (!obdIsConnected() || shouldStop()) break;
    let bytes = null;
    if (pid === 'RV') {
      const r = await obdSend('ATRV', 2000).catch(() => '');
      const v = parseFloat(String(r).replace(/[^0-9.]/g, ''));
      if (!isNaN(v)) { out.battery = v; onValue('battery', v); }
      continue;
    }
    bytes = await obdPid(pid).catch(() => null);
    for (const p of list) {
      if (!bytes || bytes.length < (p.n || 1)) continue;
      const v = p.f(bytes);
      if (v === null || v === undefined || isNaN(v)) continue;
      out[p.key] = v;
      onValue(p.key, v);
    }
  }
  // dados calculados
  for (const k of keys) {
    const p = PID_BY_KEY[k];
    if (p?.derived && p.derived.every(d => out[d] !== undefined)) {
      out[k] = p.calc(out);
      onValue(k, out[k]);
    }
  }
  return out;
}

// Formata um valor com a unidade
function fmtValue(key, v, withUnit = true) {
  const p = PID_BY_KEY[key];
  if (v === undefined || v === null || isNaN(v)) return '—';
  if (key === 'runTime') {
    const m = Math.floor(v / 60), s = Math.round(v % 60);
    return `${m}:${String(s).padStart(2, '0')}${withUnit ? ' min' : ''}`;
  }
  const txt = Number(v).toLocaleString('pt-PT', { minimumFractionDigits: p?.dec ?? 0, maximumFractionDigits: p?.dec ?? 0 });
  return withUnit && p?.unit ? `${txt} ${p.unit}` : txt;
}

// Testes da centralina (PID 01, bytes B-D). Devolve [{ name, state: 'ok'|'pending' }]
function parseReadiness(b) {
  if (!b || b.length < 4) return null;
  const diesel = !!(b[1] & 0x08);
  const out = [];
  const common = [['Falhas de combustão', 0], ['Sistema de combustível', 1], ['Componentes (sensores e atuadores)', 2]];
  for (const [name, bit] of common) {
    if (b[1] & (1 << bit)) out.push({ name, state: (b[1] & (1 << (bit + 4))) ? 'pending' : 'ok' });
  }
  const list = diesel
    ? [['Catalisador (NMHC)', 0], ['NOx / SCR', 1], ['Pressão do turbo', 3], ['Sonda de escape', 5], ['Filtro de partículas (FAP)', 6], ['EGR', 7]]
    : [['Catalisador', 0], ['Catalisador aquecido', 1], ['Sistema de evaporação', 2], ['Ar secundário', 3], ['Sonda lambda', 5], ['Aquecimento da sonda', 6], ['EGR', 7]];
  for (const [name, bit] of list) {
    if (b[2] & (1 << bit)) out.push({ name, state: (b[3] & (1 << bit)) ? 'pending' : 'ok' });
  }
  return { diesel, tests: out };
}
