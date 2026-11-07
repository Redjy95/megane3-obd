// ============================================================
//  Descrição dos códigos de avaria (OBD standard, SAE J2012)
//  Só os códigos genéricos mais comuns num 1.5 dCi (K9K).
//  Os códigos P1xxx são da Renault e não têm descrição standard.
// ============================================================

const DTC_TEXT = {
  P0016: 'Correlação entre a posição da cambota e da árvore de cames',
  P0045: 'Turbo – circuito de comando da válvula de regulação',
  P0087: 'Pressão do rail de combustível demasiado baixa',
  P0088: 'Pressão do rail de combustível demasiado alta',
  P0089: 'Regulador de pressão do combustível – funcionamento',
  P0093: 'Fuga de combustível detetada (grande)',
  P0100: 'Medidor de massa de ar (debitómetro) – circuito',
  P0101: 'Medidor de massa de ar (debitómetro) – valor fora do normal',
  P0102: 'Medidor de massa de ar (debitómetro) – sinal baixo',
  P0103: 'Medidor de massa de ar (debitómetro) – sinal alto',
  P0105: 'Sensor de pressão do coletor de admissão (MAP) – circuito',
  P0106: 'Sensor de pressão do coletor de admissão (MAP) – valor fora do normal',
  P0107: 'Sensor de pressão do coletor de admissão (MAP) – sinal baixo',
  P0108: 'Sensor de pressão do coletor de admissão (MAP) – sinal alto',
  P0110: 'Sensor de temperatura do ar de admissão – circuito',
  P0112: 'Sensor de temperatura do ar de admissão – sinal baixo',
  P0113: 'Sensor de temperatura do ar de admissão – sinal alto',
  P0115: 'Sensor de temperatura do motor – circuito',
  P0116: 'Sensor de temperatura do motor – valor fora do normal',
  P0117: 'Sensor de temperatura do motor – sinal baixo',
  P0118: 'Sensor de temperatura do motor – sinal alto',
  P0128: 'Termóstato – o motor não atinge a temperatura normal',
  P0180: 'Sensor de temperatura do combustível – circuito',
  P0190: 'Sensor de pressão do rail de combustível – circuito',
  P0191: 'Sensor de pressão do rail de combustível – valor fora do normal',
  P0192: 'Sensor de pressão do rail de combustível – sinal baixo',
  P0193: 'Sensor de pressão do rail de combustível – sinal alto',
  P0200: 'Injetores – circuito',
  P0201: 'Injetor do cilindro 1 – circuito',
  P0202: 'Injetor do cilindro 2 – circuito',
  P0203: 'Injetor do cilindro 3 – circuito',
  P0204: 'Injetor do cilindro 4 – circuito',
  P0234: 'Turbo – pressão excessiva',
  P0299: 'Turbo – pressão insuficiente',
  P0300: 'Falhas de combustão em vários cilindros',
  P0301: 'Falha de combustão no cilindro 1',
  P0302: 'Falha de combustão no cilindro 2',
  P0303: 'Falha de combustão no cilindro 3',
  P0304: 'Falha de combustão no cilindro 4',
  P0335: 'Sensor de posição da cambota – circuito',
  P0336: 'Sensor de posição da cambota – sinal fora do normal',
  P0340: 'Sensor da árvore de cames – circuito',
  P0380: 'Velas de incandescência – circuito',
  P0381: 'Luz das velas de incandescência – circuito',
  P0400: 'EGR – caudal',
  P0401: 'EGR – caudal insuficiente',
  P0402: 'EGR – caudal excessivo',
  P0403: 'EGR – circuito de comando',
  P0404: 'EGR – funcionamento fora do normal',
  P0405: 'Sensor de posição da EGR – sinal baixo',
  P0406: 'Sensor de posição da EGR – sinal alto',
  P0470: 'Sensor de pressão de escape – circuito',
  P0480: 'Ventoinha de arrefecimento – circuito de comando',
  P0500: 'Sensor de velocidade do veículo',
  P0504: 'Interruptor do pedal do travão – sinais incoerentes',
  P0530: 'Sensor de pressão do ar condicionado – circuito',
  P0560: 'Tensão da bateria fora do normal',
  P0562: 'Tensão da bateria baixa',
  P0563: 'Tensão da bateria alta',
  P0571: 'Interruptor do pedal do travão – circuito',
  P0601: 'Centralina do motor – erro de memória',
  P0606: 'Centralina do motor – erro do processador',
  P0641: 'Tensão de referência dos sensores (A) – circuito',
  P0645: 'Relé do compressor do ar condicionado – circuito',
  P0670: 'Módulo das velas de incandescência – circuito',
  P0700: 'Caixa de velocidades – avaria registada',
  P2002: 'Filtro de partículas (FAP) – eficiência abaixo do limite',
  P2226: 'Sensor de pressão atmosférica – circuito',
  P2263: 'Turbo – funcionamento do sistema',
  P242F: 'Filtro de partículas (FAP) – entupido (cinzas)',
  P2452: 'Sensor de pressão diferencial do FAP – circuito',
  P2453: 'Sensor de pressão diferencial do FAP – valor fora do normal',
  P2454: 'Sensor de pressão diferencial do FAP – sinal baixo',
  P2455: 'Sensor de pressão diferencial do FAP – sinal alto',
  U0001: 'Rede CAN – avaria de comunicação',
  U0100: 'Sem comunicação com a centralina do motor',
  U0101: 'Sem comunicação com a centralina da caixa',
  U0121: 'Sem comunicação com o ABS',
  U0140: 'Sem comunicação com a UCH (módulo do habitáculo)',
  U0155: 'Sem comunicação com o quadrante'
};

// Descrição de um código: texto conhecido, ou a família a que pertence
function dtcDescribe(code) {
  if (DTC_TEXT[code]) return { text: DTC_TEXT[code], known: true };
  const sys = { P: 'Motor/caixa', C: 'Chassis', B: 'Carroçaria', U: 'Rede de comunicação' }[code[0]] || '';
  if (code[1] === '1' || code[1] === '3') return { text: `${sys} – código específico da Renault`, known: false };
  if (code[0] === 'P') {
    const area = {
      0: 'Ar/combustível – emissões', 1: 'Ar/combustível – medição', 2: 'Ar/combustível – injetores',
      3: 'Combustão/arranque', 4: 'Emissões (EGR, FAP, escape)', 5: 'Velocidade/ralenti/entradas',
      6: 'Centralina e saídas', 7: 'Caixa de velocidades', 8: 'Caixa de velocidades', 9: 'Caixa de velocidades'
    }[code[2]];
    if (area) return { text: `${area} – código genérico`, known: false };
  }
  return { text: `${sys} – código genérico`, known: false };
}
