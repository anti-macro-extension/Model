// keyboard.js (content script) - 키보드 이벤트 수집 및 매크로 탐지기 연동
(() => {
  "use strict";

  // === 옵션 설정 ===
  const EMIT_JAMO = false;
  const AUTO_FLUSH_MS = 1200;

  // === 안전한 런타임 통신 ===
  const hasRuntime = () => typeof chrome !== "undefined" && chrome?.runtime?.id;
  const safeSend = (msg) => {
    if (!hasRuntime()) return;
    try { 
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError); 
    } catch {}
  };

  // === 타임스탬프 헬퍼 ===
  const nowRec = () => {
    const ms = Date.now();
    return { timestamp_ms: ms, timestamp_iso: new Date(ms).toISOString() };
  };

  // === 기존 로깅용 버퍼들 (선택적) ===
  let outKeys = [];
  let outTexts = [];
  let outComps = [];
  let outJamo = [];

  // === 한글 자모 맵 ===
  const JAMO_MAP = {
    KeyQ:'ㅂ', KeyW:'ㅈ', KeyE:'ㄷ', KeyR:'ㄱ', KeyT:'ㅅ',
    KeyA:'ㅁ', KeyS:'ㄴ', KeyD:'ㅇ', KeyF:'ㄹ', KeyG:'ㅎ',
    KeyZ:'ㅋ', KeyX:'ㅌ', KeyC:'ㅊ', KeyV:'ㅍ',
    KeyY:'ㅛ', KeyU:'ㅕ', KeyI:'ㅑ', KeyO:'ㅐ', KeyP:'ㅔ',
    KeyH:'ㅗ', KeyJ:'ㅓ', KeyK:'ㅏ', KeyL:'ㅣ',
    KeyB:'ㅠ', KeyN:'ㅜ', KeyM:'ㅡ',
    "Shift+KeyO":"ㅒ", "Shift+KeyP":"ㅖ"
  };
  
  const codeToJamo = (code, shift) => JAMO_MAP[shift ? `Shift+${code}` : code] || JAMO_MAP[code] || "";
  const isJamoChar = (ch) =>
    typeof ch === "string" && ch.length === 1 && (/[\u3131-\u318E\u1100-\u11FF]/.test(ch));

  // === 기존 데이터 플러시 (로깅용, 선택적) ===
  function flush(kind = "ALL") {
    try {
      if ((kind === "ALL" || kind === "KEYS") && outKeys.length) {
        const p = outKeys; outKeys = [];
        safeSend({ kind: "KEYS", payload: p });
      }
      if ((kind === "ALL" || kind === "TEXT") && outTexts.length) {
        const p = outTexts; outTexts = [];
        safeSend({ kind: "KEYS", payload: p });
      }
      if ((kind === "ALL" || kind === "COMP") && outComps.length) {
        const p = outComps; outComps = [];
        safeSend({ kind: "KEYS", payload: p });
      }
      if (EMIT_JAMO && (kind === "ALL" || kind === "JAMO") && outJamo.length) {
        const p = outJamo.map(r => {
          if (!isJamoChar(r.key)) {
            const fixed = codeToJamo(r.code, r.shift);
            if (fixed) r.key = fixed;
          }
          return r;
        });
        outJamo = [];
        safeSend({ kind: "KEYS", payload: p });
      }
    } catch {}
  }

  // 자동 플러시 타이머 (기존 로깅용)
  let tmr = setInterval(() => flush("ALL"), AUTO_FLUSH_MS);

  // === IME/Process 윈도우 ===
  let lastProcessTs = 0;
  const PROCESS_WINDOW_MS = 140;
  const processActive = () => (Date.now() - lastProcessTs) <= PROCESS_WINDOW_MS;

  // === 키보드 이벤트 핸들러 ===
  function onKey(ev) {
    const base = nowRec();
    const displayKey = (ev.key === "Process" && ev.code) ? ev.code : ev.key;

    // === 1) 기존 로깅 (선택적으로 유지) ===
    const keyData = {
      ...base,
      type: ev.type,
      key: displayKey,
      key_raw: ev.key,
      code: ev.code,
      repeat: !!ev.repeat,
      ctrl: !!ev.ctrlKey, 
      alt: !!ev.altKey, 
      shift: !!ev.shiftKey, 
      meta: !!ev.metaKey
    };

    // 기존 버퍼에 추가 (로깅용)
    outKeys.push(keyData);
    if (outKeys.length >= 200) flush("KEYS");

    // === 2) 실시간 매크로 탐지기에 데이터 전달 ===
    if (window.realtimeMacroDetector) {
      const macroKeyData = {
        type: ev.type,
        key: displayKey,
        code: ev.code,
        timestamp: base.timestamp_ms
      };
      
      // 매크로 탐지기로 직접 전달
      window.realtimeMacroDetector.processKeyEvent(macroKeyData);
    }

    // === 3) IME Process 타이밍 기억 ===
    if (ev.type === "keydown" && ev.key === "Process") {
      lastProcessTs = Date.now();
    }

    // === 4) 한글 자모 캡처 (옵션) ===
    if (EMIT_JAMO && ev.type === "keydown" && (ev.isComposing || processActive())) {
      const j = codeToJamo(ev.code, ev.shiftKey);
      if (j) {
        outJamo.push({ 
          ...base, 
          type: "jamo", 
          key: j, 
          code: ev.code, 
          shift: !!ev.shiftKey 
        });
        if (outJamo.length >= 120) flush("JAMO");
      }
    }
  }

  // === 이벤트 리스너 등록 ===
  addEventListener("keydown", onKey, true);
  addEventListener("keyup", onKey, true);

  // === Composition 이벤트들 (IME 입력) ===
  addEventListener("compositionstart", (e) => {
    outComps.push({ ...nowRec(), type: "compstart", key: e.data ?? "" });
    if (outComps.length >= 80) flush("COMP");
  }, true);

  addEventListener("compositionupdate", (e) => {
    outComps.push({ ...nowRec(), type: "compupdate", key: e.data ?? "" });
    if (outComps.length >= 80) flush("COMP");
  }, true);

  addEventListener("compositionend", (e) => {
    const r = nowRec(); 
    const s = e.data ?? "";
    outComps.push({ ...r, type: "compend", key: s });
    if (s) outTexts.push({ ...r, type: "text", key: s });
    flush("COMP");
    if (outTexts.length >= 80) flush("TEXT");
  }, true);

  // === Input 이벤트 (실제 텍스트 입력) ===
  addEventListener("input", (e) => {
    try {
      if ((e.inputType || "").startsWith("insert")) {
        const s = typeof e.data === "string" ? e.data : "";
        if (s) { 
          outTexts.push({ ...nowRec(), type: "text", key: s }); 
          if (outTexts.length >= 80) flush("TEXT"); 
        }
      }
    } catch {}
  }, true);

  // === 페이지 라이프사이클 ===
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      try { clearInterval(tmr); } catch {}
      flush("ALL");
      // 백그라운드 복귀 시 다시 타이머 시작
      try { tmr = setInterval(() => flush("ALL"), AUTO_FLUSH_MS); } catch {}
    }
  }, true);

  addEventListener("pagehide", () => {
    try { clearInterval(tmr); } catch {}
    flush("ALL");
    
    // 매크로 탐지기 세션 통계 전송
    if (window.realtimeMacroDetector) {
      const stats = window.realtimeMacroDetector.getStats();
      safeSend({
        kind: "SESSION_END",
        payload: {
          url: window.location.href,
          domain: window.location.hostname,
          stats: stats,
          sessionDuration: Date.now() - performance.timeOrigin
        }
      });
    }
  }, true);

  // === 런타임 메시지 리스너 (설정 변경 등) ===
  if (hasRuntime()) {
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // 매크로 탐지기 설정 업데이트
        if (message.kind === "UPDATE_DETECTOR_CONFIG" && window.realtimeMacroDetector) {
          window.realtimeMacroDetector.updateConfig(message.config);
          sendResponse({ success: true });
          return true;
        }
        
        // 매크로 탐지기 통계 요청
        if (message.kind === "GET_DETECTOR_STATS" && window.realtimeMacroDetector) {
          const stats = window.realtimeMacroDetector.getStats();
          sendResponse({ success: true, stats });
          return true;
        }
        
        // 매크로 탐지기 데이터 초기화
        if (message.kind === "CLEAR_DETECTOR_DATA" && window.realtimeMacroDetector) {
          window.realtimeMacroDetector.clearData();
          sendResponse({ success: true });
          return true;
        }
        
        return false;
      });
    } catch {}
  }

  // === 매크로 탐지기 연결 확인 (폴링 방식) ===
function waitForDetector() {
  let attempts = 0;
  const maxAttempts = 10;
  
  const checkConnection = () => {
    attempts++;
    
    if (window.realtimeMacroDetector && typeof window.realtimeMacroDetector.getStats === 'function') {
      console.log(`✅ 매크로 탐지기 연결 성공 (${attempts}번째 시도)`);
      console.log('📊 초기 상태:', window.realtimeMacroDetector.getStats());
      return;
    }
    
    if (attempts < maxAttempts) {
      console.log(`🔄 매크로 탐지기 대기 중... (${attempts}/${maxAttempts})`);
      setTimeout(checkConnection, 500); // 0.5초마다 재시도
    } else {
      console.error('❌ 매크로 탐지기 연결 실패 - realtime_keyboard_macro.js 로드 확인 필요');
    }
  };
  
  checkConnection();
}

// === 초기화 완료 로그 ===
console.log('🎯 키보드 수집기 시작됨');

// DOM 로드 완료 후 매크로 탐지기 연결 확인
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', waitForDetector);
} else {
  waitForDetector();
}

})();