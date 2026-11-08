# OBD Mégane 3

App web (PWA) de diagnóstico OBD para o **Renault Mégane III Grand Tour 1.5 dCi 110cv** (KZ1G, 81 kW, 2010), com um adaptador **ELM327 Bluetooth LE** ("OBDBLE").

⚠️ **Usar só com o carro parado.**

## Como usar

1. **iPhone:** abrir o site na app gratuita **Bluefy** (o Safari não tem Bluetooth). **Android:** Chrome.
2. Ligar o adaptador à tomada OBD (debaixo do tablier, lado do condutor).
3. Ligar a ignição (o motor pode estar desligado).
4. Tocar em **Ligar** e escolher o "OBDBLE".

Ao ligar, a app lê sozinha as avarias, os dados do carro e do motor. O separador **Motor** atualiza continuamente enquanto estiver aberto.

## O que faz

- **Avarias:** luz do motor, avarias confirmadas (modo 03) e pendentes (modo 07) com descrição em português, dados no momento da avaria (modo 02), apagar avarias (modo 04) e histórico de leituras.
- **Painel:** painéis personalizáveis com mostradores, números e gráficos. Painéis de origem: Motor, Turbo, Elétrico, Injeção e emissões. Cada dado tem limites de alerta configuráveis. Gravação dos valores em CSV.
- **Saúde:** verificação rápida (bateria, alternador, temperaturas, sensor de pressão do turbo, turbo pedido vs. medido, EGR, FAP), testes guiados (bateria no arranque, alternador com consumos, resposta do turbo) e testes da centralina (PID 01).
- **Sensores:** todos os dados OBD standard que o carro envia, em tempo real.
- **Carro:** VIN (0902), tentativa de ler o conta-km (PID A6), distâncias, relatório para partilhar e registo técnico.

Ao ligar, a app lê sozinha as avarias, os testes da centralina e os dados do carro. Painel e Sensores atualizam enquanto estiverem abertos.

Lê só a centralina do motor (OBD standard). Airbag, ABS e outros módulos precisam de ferramenta Renault.

## Ficheiros

- `obd.js` — ligação BLE e comunicação com o ELM327 (baseado no da app [check-megane3](https://github.com/Redjy95/check-megane3))
- `dtc.js` — descrição dos códigos de avaria
- `pids.js` — catálogo dos dados OBD (fórmulas, unidades, limites)
- `dash.js` — painéis, sensores e leitura contínua
- `health.js` — verificação rápida e testes guiados
- `app.js` — interface
- `sw.js` — funciona sem rede (mudar a versão da cache e o `?v=` dos scripts no `index.html` sempre que os ficheiros mudarem)
