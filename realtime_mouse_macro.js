// === realtime_mouse_macro.js ===
// 🐭 마우스 매크로 실시간 탐지 (ONNX Transformer 모델 + 디버깅 로그 강화)

console.log("[DEBUG] realtime_mouse_macro.js 로드됨 ✅");
console.log("ort =", window.ort);

(async () => {
  "use strict";

  const buffer = [];
  const SEQ_LEN = 200;   // ✅ Python 학습 시 맞춘 길이 (200으로 수정)
  const FEATURE_DIM = 3; // [ecode, x, y]

  let session = null;
  let modelLoading = false;

  // === ORT 준비 대기 + wasm 경로 강제 세팅 ===
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

    console.log("[DEBUG] ✅ ORT 객체 확인됨:", window.ort);

    const wasmBase = chrome.runtime.getURL("libs/");
    window.ort.env.wasm.wasmPaths = {
      "ort-wasm.wasm": wasmBase + "ort-wasm.wasm",
      "ort-wasm-threaded.wasm": wasmBase + "ort-wasm-threaded.wasm",
      "ort-wasm-simd.wasm": wasmBase + "ort-wasm-simd.wasm",
      "ort-wasm-simd-threaded.wasm": wasmBase + "ort-wasm-simd-threaded.wasm"
    };

    window.ort.env.wasm.numThreads = 1;
    window.ort.env.wasm.simd = false;

    console.log("[DEBUG] ORT wasmPaths 설정 완료:", window.ort.env.wasm.wasmPaths);
    console.log("[DEBUG] ort.env.wasm =", window.ort.env.wasm);

    try {
      const testUrl = wasmBase + "ort-wasm.wasm";
      console.log("[DEBUG] fetch 테스트 시도:", testUrl);
      const res = await fetch(testUrl);
      console.log("[DEBUG] fetch 결과:", res.status);
    } catch (e) {
      console.error("❌ fetch 테스트 실패:", e);
    }

    return true;
  }

  // === ONNX 모델 로드 ===
  async function loadModel() {
    if (session || modelLoading) return;
    modelLoading = true;

    console.log("[DEBUG] loadModel() 호출됨");

    const ready = await waitOrtReady();
    if (!ready) {
      console.error("❌ ORT 준비 실패로 모델 로드 중단");
      modelLoading = false;
      return;
    }

    const modelUrl = chrome.runtime.getURL("models/mouse_transformer_fixed.onnx");
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

  // === mouse.js에서 이벤트 받기 ===
  window.realtimeMouseDetector = {
    addMouseEvent(event) {
      console.log("[DEBUG] addMouseEvent 호출됨:", event.type);

      buffer.push(event);
      if (buffer.length > SEQ_LEN) buffer.shift();

      console.log("📥 [MOUSE-MACRO] 이벤트 수신:", event);

      // ✅ 버퍼가 부족해도 padSequence로 맞춰서 바로 inference 실행
      console.log("🔍 [DEBUG] 분석 실행 준비 (버퍼 길이):", buffer.length);
      analyzeMouseBuffer([...buffer]);
    }
  };

  // === 특징 벡터 변환 ===
  function extractMouseFeatures(events) {
    return events.map(ev => {
      let ecode = 0;
      if (ev.type === "move") ecode = 0;
      else if (["click", "up", "down"].includes(ev.type)) ecode = 1;
      else if (ev.type === "wheel") ecode = 2;

      // === 좌표 정규화 (학습 코드와 동일)
      const normX = (ev.x || 0) / window.innerWidth;
      const normY = (ev.y || 0) / window.innerHeight;

      return [ecode, normX, normY];
    });
  }



  // === padding/trim ===
  function padSequence(features, seqLen = SEQ_LEN, featureDim = FEATURE_DIM) {
    if (features.length > seqLen) {
      return features.slice(-seqLen);
    }
    while (features.length < seqLen) {
      features.unshift(new Array(featureDim).fill(0));
    }
    return features;
  }

  // === 모델 추론 ===
  async function analyzeMouseBuffer(events) {
    try {
      console.log("[DEBUG] analyzeMouseBuffer 실행됨, 이벤트 개수:", events.length);
      if (!session) {
        console.warn("⏳ 세션이 아직 준비되지 않음 → 모델 로드 시도");
        await loadModel();
        return;
      }

      const features = extractMouseFeatures(events);
      const padded = padSequence(features);

      const inputTensor = new window.ort.Tensor(
        "float32",
        Float32Array.from(padded.flat()),
        [1, SEQ_LEN, FEATURE_DIM]
      );

      console.log("[DEBUG] 입력 Tensor shape:", inputTensor.dims);

      const feeds = {};
      feeds[session.inputNames[0]] = inputTensor;

      console.log("[DEBUG] session.run() 호출 시작");
      const results = await session.run(feeds);
      console.log("[DEBUG] session.run() 완료:", results);

      const outputName = session.outputNames[0];
      const logits = results[outputName].data;

      console.log("[DEBUG] 모델 raw 출력:", logits);

      const exp = logits.map(Math.exp);
      const sumExp = exp.reduce((a, b) => a + b, 0);
      const probs = exp.map(v => v / sumExp);

      const confidence = probs[1]; // [0]=human, [1]=macro
      console.log("🎯 [MOUSE-ML] 매크로 확률:", (confidence * 100).toFixed(1) + "%");

      chrome.runtime.sendMessage({
        kind: "MACRO_DETECTED",
        payload: {
          method: "onnx-transformer",
          confidence,
          timestamp: Date.now(),
          domain: window.location.hostname,
          type: "mouse"
        }
      });
    } catch (err) {
      console.error("❌ [MOUSE-ML] 분석 실패:", err);
    }
  }

  // === 초기화 ===
  await loadModel();
  console.log("🎯 마우스 매크로 탐지기 초기화 완료 (ONNX)");
})();
