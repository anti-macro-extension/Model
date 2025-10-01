// === mouse.js — 마우스 이동/클릭/휠 수집 & 탐지기 연결 ===
console.log("[DEBUG] mouse.js 로드됨");

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

  function forwardToDetector(payload) {
    console.log("🖱️ RAW Mouse Event:", payload);
    if (window.realtimeMouseDetector && typeof window.realtimeMouseDetector.addMouseEvent === "function") {
      try {
        window.realtimeMouseDetector.addMouseEvent(payload);
      } catch (e) {
        console.warn("⚠️ MouseDetector 전달 실패:", e);
      }
    }
  }

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

    const payload = {
      timestamp: Date.now(),
      t: now / 1000,
      x, y,
      type: "move",
      speed_per_step: speed
    };

    safeSend(payload);
    forwardToDetector(payload);
  }

  addEventListener("mousemove", emitMove, { passive: true });

  addEventListener("mousedown", (e) => {
    const payload = {
      timestamp: Date.now(),
      t: performance.now() / 1000,
      x: e.clientX, y: e.clientY,
      type: "down",
      button: e.button === 0 ? "l" : e.button === 1 ? "m" : e.button === 2 ? "r" : String(e.button)
    };
    safeSend(payload);
    forwardToDetector(payload);
  }, { passive: true });

  addEventListener("mouseup", (e) => {
    const payload = {
      timestamp: Date.now(),
      t: performance.now() / 1000,
      x: e.clientX, y: e.clientY,
      type: "up",
      button: e.button === 0 ? "l" : e.button === 1 ? "m" : e.button === 2 ? "r" : String(e.button)
    };
    safeSend(payload);
    forwardToDetector(payload);
  }, { passive: true });

  addEventListener("click", (e) => {
    const payload = {
      timestamp: Date.now(),
      t: performance.now() / 1000,
      x: e.clientX, y: e.clientY,
      type: "click",
      button: e.button === 0 ? "l" : e.button === 1 ? "m" : e.button === 2 ? "r" : String(e.button)
    };
    safeSend(payload);
    forwardToDetector(payload);
  }, { passive: true });

  addEventListener("wheel", (e) => {
    const amount = -e.deltaY;
    cumScroll += amount;
    const payload = {
      timestamp: Date.now(),
      t: performance.now() / 1000,
      type: "wheel",
      x: e.clientX,
      y: e.clientY,
      amount: -e.deltaY,
      cum_scroll: Math.round(cumScroll)
    };
    safeSend(payload);
    forwardToDetector(payload);
  }, { passive: true });


  // === [추가] 매크로 이벤트 테스트 함수 ===
  function runMacroTest() {
    console.log("[TEST] 매크로 이벤트 자동 생성 시작");

    let i = 0;
    const interval = setInterval(() => {
      if (i >= 200) {   // 200개의 move 이벤트 발생
        clearInterval(interval);
        console.log("[TEST] 매크로 이벤트 완료");
        return;
      }

      const ev = {
        type: "move",
        x: i,
        y: i,
        timestamp: Date.now()
      };

      forwardToDetector(ev);  // 실시간 탐지기로 전달
      i++;
    }, 10); // 10ms 간격 (매우 빠른 매크로 같은 패턴)
  }

  // 페이지 로드 후 2초 뒤 실행 (실험용)
  setTimeout(runMacroTest, 2000);

})();
