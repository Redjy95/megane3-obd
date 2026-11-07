# OBD Mégane 3

App web (PWA) de diagnóstico OBD para o **Renault Mégane III Grand Tour 1.5 dCi 110cv** (KZ1G, 81 kW, 2010), com um adaptador **ELM327 Bluetooth LE** ("OBDBLE").

⚠️ **Usar só com o carro parado.**

## Como usar

1. **iPhone:** abrir o site na app gratuita **Bluefy** (o Safari não tem Bluetooth). **Android:** Chrome.
2. Ligar o adaptador à tomada OBD (debaixo do tablier, lado do condutor).
3. Ligar a ignição (o motor pode estar desligado).
4. Tocar em **Ligar** e escolher o "OBDBLE".

## O que faz

- **Avarias:** luz do motor, avarias confirmadas (modo 03) e pendentes (modo 07) com descrição em português, dados no momento da avaria (modo 02), apagar avarias (modo 04) e histórico de leituras.
- **Motor:** bateria (ATRV), temperatura, rotações, velocidade, pressão do turbo, carga, ar de admissão, caudal de ar, pressão do rail e tensão da centralina, em leitura única ou contínua.
- **Carro:** VIN (0902), tentativa de ler o conta-km (PID A6) e distâncias (PIDs 21 e 31).
- **Registo:** respostas do adaptador, comandos manuais e relatório para partilhar.

Lê só a centralina do motor (OBD standard). Airbag, ABS e outros módulos precisam de ferramenta Renault.

## Ficheiros

- `obd.js` — ligação BLE e comunicação com o ELM327 (baseado no da app [check-megane3](https://github.com/Redjy95/check-megane3))
- `dtc.js` — descrição dos códigos de avaria
- `app.js` — interface
- `sw.js` — funciona sem rede (mudar a versão da cache sempre que os ficheiros mudarem)
