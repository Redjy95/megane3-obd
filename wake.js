// ============================================================
//  Manter o ecrã ligado (sem mudar as Definições do iPhone)
//  1.º tenta o pedido oficial do browser (Screen Wake Lock);
//  2.º se não houver, toca um vídeo minúsculo, invisível e sem som,
//      em ciclo: o iPhone não apaga o ecrã enquanto há vídeo a tocar.
//  Tem de ser ativado a partir de um toque do utilizador.
// ============================================================

const keepAwake = { lock: null, video: null, method: '' };

// Devolve uma promessa com o método que ficou ativo ('wakelock', 'video' ou '')
function keepAwakeOn() {
  // o vídeo tem de começar já, dentro do toque (o iPhone bloqueia-o se esperar)
  const videoReady = startAwakeVideo();
  return (async () => {
    try {
      if (navigator.wakeLock) {
        keepAwake.lock = await navigator.wakeLock.request('screen');
        keepAwake.method = 'wakelock';
        stopAwakeVideo();
        return keepAwake.method;
      }
    } catch {}
    keepAwake.method = (await videoReady) ? 'video' : '';
    return keepAwake.method;
  })();
}

function keepAwakeOff() {
  try { keepAwake.lock?.release(); } catch {}
  keepAwake.lock = null;
  stopAwakeVideo();
  keepAwake.method = '';
}

function startAwakeVideo() {
  try {
    let v = keepAwake.video;
    if (!v) {
      v = document.createElement('video');
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.muted = true;
      v.loop = true;
      v.src = 'keepawake.mp4?v=10';
      v.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1';
      document.body.appendChild(v);
      keepAwake.video = v;
    }
    return v.play().then(() => true, () => false);
  } catch { return Promise.resolve(false); }
}

function stopAwakeVideo() {
  try { keepAwake.video?.pause(); } catch {}
}

// O pedido oficial é cancelado quando a app vai para segundo plano: volta a pedir
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || keepAwake.method !== 'wakelock') return;
  try { keepAwake.lock = await navigator.wakeLock.request('screen'); } catch {}
});
