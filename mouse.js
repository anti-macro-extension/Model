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
    if (window.realtimeMouseDetector && typeof window.realtimeMouseDetector.addMouseEvent === "function") {
      try {
        window.realtimeMouseDetector.addMouseEvent(payload);
      } catch (e) {
        console.warn("⚠️ MouseDetector 전달 실패:", e);
      }
    }
  }

  // === ✅ 초기 사람 행동처럼 보이는 클릭/스크롤 데이터 여러 개 삽입 ===
  function injectStartupHumanActions() {
    console.log("[DEBUG] 초기 클릭/스크롤 이벤트 삽입 시작");

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const baseTs = Date.now();
    const baseT = performance.now() / 1000;

    // 👆 사람처럼 클릭 3회 + 스크롤 3회 정도 생성
    const fakeEvents = [];

    // 1~3번 클릭 (좌클릭)
    for (let i = 0; i < 3; i++) {
      fakeEvents.push({
        timestamp: baseTs + i * 100,
        t: baseT + i * 0.1,
        x: centerX + Math.random() * 10 - 5,
        y: centerY + Math.random() * 10 - 5,
        type: "click",
        button: "l"
      });
    }

    // 4~6번 스크롤 (마우스휠)
    for (let i = 0; i < 3; i++) {
      fakeEvents.push({
        timestamp: baseTs + 400 + i * 120,
        t: baseT + 0.5 + i * 0.1,
        type: "wheel",
        x: centerX,
        y: centerY,
        amount: -120,                // 일반적인 스크롤 값
        cum_scroll: Math.round(cumScroll += -120)
      });
    }

    // 전달
    for (const ev of fakeEvents) {
      safeSend(ev);
      forwardToDetector(ev);
    }

    console.log(`[DEBUG] 초기 이벤트 ${fakeEvents.length}개 삽입 완료`);
  }

  // === 마우스 이동 감지 ===
  function emitMove(e) {
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

  // === ✅ 시작 시 사람 행동 패턴 데이터 여러 개 삽입 ===
  injectStartupHumanActions();

})();
