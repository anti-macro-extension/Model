// === mouse.js — 마우스 이동/클릭/휠 수집 → kind:"MOUSE"(단건) 전송 (MV3 안전)
// 기존 너의 코드(배치, kind:"MOUSE_POS")를 친구 bg 규격(단건, kind:"MOUSE")으로 맞춤
(() => {
  const THROTTLE_MS = 50;      // ~20Hz 샘플링
  const IGNORE_STEP_2PX = true;

  let lastX = null, lastY = null;
  let lastMoveTs = 0;
  let cumScroll = 0;

  const hasRuntime = () => typeof chrome !== "undefined" && chrome?.runtime?.id;
  const safeSend = (payload) => {
    if (!hasRuntime()) return;
    try { chrome.runtime.sendMessage({ kind: "MOUSE", payload }, () => void chrome.runtime.lastError); } catch {}
  };

  function emitMove(e){
    const now = performance.now();
    if (now - lastMoveTs < THROTTLE_MS) return;

    const x = e.clientX, y = e.clientY;
    let speed = "";
    if (lastX != null && lastY != null) {
      const dx = x - lastX, dy = y - lastY;
      const dist = Math.hypot(dx, dy);
      if (IGNORE_STEP_2PX && dist < 2) return;
      speed = Number.isFinite(dist) ? dist.toFixed(2) : "";
    }
    lastMoveTs = now; lastX = x; lastY = y;

    safeSend({
      timestamp: Date.now(),
      t: now / 1000,        // 상대 초(참고용)
      x, y,
      type: "move",
      speed_per_step: speed
    });
  }

  addEventListener("mousemove", emitMove, { passive: true });

  addEventListener("mousedown", (e) => {
    safeSend({
      timestamp: Date.now(),
      t: performance.now() / 1000,
      x: e.clientX, y: e.clientY,
      type: "down",
      button: e.button === 0 ? "l" : e.button === 1 ? "m" : e.button === 2 ? "r" : String(e.button)
    });
  }, { passive: true });

  addEventListener("mouseup", (e) => {
    safeSend({
      timestamp: Date.now(),
      t: performance.now() / 1000,
      x: e.clientX, y: e.clientY,
      type: "up",
      button: e.button === 0 ? "l" : e.button === 1 ? "m" : e.button === 2 ? "r" : String(e.button)
    });
  }, { passive: true });

  addEventListener("click", (e) => {
    safeSend({
      timestamp: Date.now(),
      t: performance.now() / 1000,
      x: e.clientX, y: e.clientY,
      type: "click",
      button: e.button === 0 ? "l" : e.button === 1 ? "m" : e.button === 2 ? "r" : String(e.button)
    });
  }, { passive: true });

  addEventListener("wheel", (e) => {
    const amount = -e.deltaY; // 위 + / 아래 -
    cumScroll += amount;
    safeSend({
      timestamp: Date.now(),
      t: performance.now() / 1000,
      type: "wheel",
      amount: Math.round(amount),
      cum_scroll: Math.round(cumScroll)
    });
  }, { passive: true });
})();