// === realtime_mouse_macro_fixed.js ===
// 🧠 마우스 매크로 실시간 탐지 (속도 + 가속도 기반 Transformer 모델)
// 모델: mouse_transformer_speed_fixed.onnx

console.log("[DEBUG] realtime_mouse_macro_fixed.js 로드됨 ✅");
console.log("ort =", window.ort);

(async () => {
  "use strict";

  // ==============================
  // 기본 설정
  // ==============================
  const buffer = [];
  const SEQ_LEN = 200;   // Python 학습 시 사용한 길이
  const FEATURE_DIM = 5; // [ecode, norm_x, norm_y, speed, accel]
  const SCREEN_W = window.innerWidth;
  const SCREEN_H = window.innerHeight;

  let session = null;
  let modelLoading = false;

  // ==============================
  // ORT 준비 (wasm 경로 설정)
  // ==============================
  async function waitOrtReady() {
    let tries = 0;
    while (!(window.ort && window.ort.env && window.ort.env.wasm)) {
      console.log(`[DEBUG] ORT 준비 대기중... (tries=${++tries})`);
      await new Promise(r => setTimeout(r, 300));
      if (tries > 20) {
        console.error("❌ ORT가 6초 안에 준비되지 않았습니다. ort-web.min.js 확인 필요!");
        return false;
      }
    }

    const wasmBase = chrome.runtime.getURL("libs/");
    window.ort.env.wasm.wasmPaths = {
      "ort-wasm.wasm": wasmBase + "ort-wasm.wasm",
      "ort-wasm-simd.wasm": wasmBase + "ort-wasm-simd.wasm",
      "ort-wasm-simd-threaded.wasm": wasmBase + "ort-wasm-simd-threaded.wasm"
    };
    window.ort.env.wasm.numThreads = 1;
    window.ort.env.wasm.simd = true;

    console.log("[DEBUG] ✅ ORT 초기화 완료");
    return true;
  }

  // ==============================
  // ONNX 모델 로드
  // ==============================
  async function loadModel() {
    if (session || modelLoading) return;
    modelLoading = true;

    console.log("[DEBUG] loadModel() 호출됨");
    const ready = await waitOrtReady();
    if (!ready) {
      modelLoading = false;
      return;
    }

    const modelUrl = chrome.runtime.getURL("models/mouse_transformer_speed_fixed.onnx");
    console.log("[DEBUG] 모델 로드 시도:", modelUrl);

    try {
      session = await window.ort.InferenceSession.create(modelUrl, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all"
      });
      console.log("✅ ONNX 모델 로드 완료:", modelUrl);
    } catch (err) {
      console.error("❌ ONNX 모델 로드 실패:", err);
    } finally {
      modelLoading = false;
    }
  }

  // ==============================
  // Mouse.js → 데이터 수신
  // ==============================
  window.realtimeMouseDetector = {
    addMouseEvent(event) {
      buffer.push(event);
      if (buffer.length > SEQ_LEN) buffer.shift(); // 최신 200개 유지

      // 정확히 200개 쌓인 순간부터 추론
      if (buffer.length === SEQ_LEN) {
        analyzeMouseBuffer([...buffer]);
      } else {
        console.log(`[DEBUG] 이벤트 수: ${buffer.length}/200 (대기 중)`);
      }
    }
  };

  // ==============================
  // 특징 벡터 변환 (속도 + 가속도 포함)
  // ==============================
  function extractMouseFeatures(events) {
    const features = [];
    let prevSpeed = 0;
    let prevTs = 0;
    let prevX = null, prevY = null;

    for (const ev of events) {
      // 이벤트 코드
      let ecode = 0;
      if (ev.type === "move") ecode = 0;
      else if (["click", "down", "up"].includes(ev.type)) ecode = 1;
      else if (ev.type === "wheel") ecode = 2;

      // 좌표 정규화
      const nx = (ev.x || 0) / SCREEN_W;
      const ny = (ev.y || 0) / SCREEN_H;

      // === 속도 및 가속도 계산 ===
      const now = ev.timestamp || Date.now();
      let speed = 0, accel = 0;

      if (prevX != null && prevY != null && prevTs > 0) {
        const dx = (ev.x - prevX) / SCREEN_W;
        const dy = (ev.y - prevY) / SCREEN_H;
        const dt = Math.max(1, now - prevTs); // ms 차이
        speed = Math.sqrt(dx * dx + dy * dy) / dt;
        accel = (speed - prevSpeed) / dt;
      }

      prevSpeed = speed;
      prevTs = now;
      prevX = ev.x;
      prevY = ev.y;

      features.push([ecode, nx, ny, speed, accel]);
    }

    return features;
  }

  // ==============================
  // Padding (학습 대비용)
  // ==============================
  function padSequence(features) {
    if (features.length > SEQ_LEN) {
      return features.slice(-SEQ_LEN);
    }
    while (features.length < SEQ_LEN) {
      features.unshift(new Array(FEATURE_DIM).fill(0));
    }
    return features;
  }

  // ==============================
  // 모델 추론
  // ==============================
  async function analyzeMouseBuffer(events) {
    try {
      if (!session) {
        await loadModel();
        return;
      }

      const features = extractMouseFeatures(events);
      const padded = padSequence(features);

      // 모든 값이 0이면 추론 스킵 (초기 상태 방지)
      const allZero = padded.flat().every(v => v === 0);
      if (allZero) {
        console.log("[DEBUG] 초기 입력(0값) → 예측 스킵");
        return;
      }

      const inputTensor = new window.ort.Tensor(
        "float32",
        Float32Array.from(padded.flat()),
        [1, SEQ_LEN, FEATURE_DIM]
      );

      const feeds = {};
      feeds[session.inputNames[0]] = inputTensor;

      const results = await session.run(feeds);
      const outputName = session.outputNames[0];
      const logits = results[outputName].data;

      // softmax 변환
      const exp = logits.map(Math.exp);
      const sumExp = exp.reduce((a, b) => a + b, 0);
      const probs = exp.map(v => v / sumExp);

      const humanProb = probs[0];
      const macroProb = probs[1];

      console.log(`🎯 [MOUSE-ML] Human=${(humanProb * 100).toFixed(1)}% | Macro=${(macroProb * 100).toFixed(1)}%`);

      // 탐지 신호 전송
      chrome.runtime.sendMessage({
        kind: "MACRO_DETECTED",
        payload: {
          method: "onnx-transformer",
          confidence: macroProb,
          timestamp: Date.now(),
          domain: window.location.hostname,
          type: "mouse"
        }
      });

      // 콘솔 경고 표시
      if (macroProb > 0.9) {
        console.warn("🚨 매크로 의심 행동 탐지!");
      }

    } catch (err) {
      console.error("❌ [MOUSE-ML] 분석 실패:", err);
    }
  }

  // ==============================
  // 초기화
  // ==============================
  await loadModel();
  console.log("✅ 마우스 매크로 탐지기 초기화 완료 (속도+가속도 기반)");
})();
