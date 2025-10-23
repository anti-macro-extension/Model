// === realtime_mouse_macro.js  ===
console.log("[DEBUG] realtime_mouse_macro.js 로드됨 ✅");

(async () => {
  "use strict";

  const buffer = [];
  const SEQ_LEN = 200;
  const FEATURE_DIM = 3;

  let session = null;
  let modelLoading = false;

  // ✅ 추가: 탐지 히스토리 관리
  const DETECTION_STATE = {
    history: [],              // 최근 예측 결과들
    lastAlertTime: 0,         // 마지막 알림 시각
    consecutiveHigh: 0        // 연속 높은 확률 카운트
  };

  const CONFIG = {
    HISTORY_SIZE: 5,          // 5회 연속 확인
    CONFIDENCE_THRESHOLD: 0.65, // 개별 임계값
    AVG_THRESHOLD: 0.70,      // 평균 임계값
    BLOCK_THRESHOLD: 0.75,     // ✅ 75% 이상이면 차단!
    ALERT_COOLDOWN: 10000,     // 10초마다 최대 1번 알림
    BLOCK_COOLDOWN: 30000      // ✅ 30초에 한 번만 차단
  };

  function calculatePatternDiversity(events) {
    if (events.length < 5) return { diversity: 100, isRepetitive: false };
    const movements = [];
    for (let i = 1; i < events.length; i++) {
      const dx = events[i].x - events[i-1].x;
      const dy = events[i].y - events[i-1].y;
      movements.push(Math.hypot(dx, dy));
    }
    const mean = movements.reduce((a, b) => a + b, 0) / movements.length;
    const variance = movements.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / movements.length;
    const std = Math.sqrt(variance);
    return { diversity: std, isRepetitive: std < 5 };
  }

  function padSequence(features, seqLen = SEQ_LEN, featureDim = FEATURE_DIM) {
    if (features.length > seqLen) return features.slice(-seqLen);
    while (features.length < seqLen) features.unshift(new Array(featureDim).fill(0));
    return features;
  }

  function extractMouseFeatures(events) {
    return events.map(ev => {
      let ecode = 0;
      if (ev.type === "move") ecode = 0;
      else if (["click", "up", "down"].includes(ev.type)) ecode = 1;
      else if (ev.type === "wheel") ecode = 2;
      return [ecode, (ev.x || 0) / window.innerWidth, (ev.y || 0) / window.innerHeight];
    });
  }

  // === ORT 준비 대기 ===
  async function waitOrtReady() {
    let tries = 0;
    while (!(window.ort && window.ort.env && window.ort.env.wasm)) {
      console.log(`[DEBUG] ORT 준비 대기중... (tries=${++tries})`);
      await new Promise(r => setTimeout(r, 300));
      if (tries > 20) {
        console.error("❌ ORT가 준비되지 않았습니다.");
        return false;
      }
    }

    const wasmBase = chrome.runtime.getURL("libs/");
    window.ort.env.wasm.wasmPaths = {
      "ort-wasm.wasm": wasmBase + "ort-wasm.wasm",
      "ort-wasm-threaded.wasm": wasmBase + "ort-wasm-threaded.wasm",
      "ort-wasm-simd.wasm": wasmBase + "ort-wasm-simd.wasm",
      "ort-wasm-simd-threaded.wasm": wasmBase + "ort-wasm-simd-threaded.wasm"
    };
    window.ort.env.wasm.numThreads = 1;
    window.ort.env.wasm.simd = false;

    return true;
  }

  // === ONNX 모델 로드 ===
  async function loadModel() {
    if (session || modelLoading) return;
    modelLoading = true;

    const ready = await waitOrtReady();
    if (!ready) {
      modelLoading = false;
      return;
    }

    const modelUrl = chrome.runtime.getURL("models/mouse_transformer_fixed.onnx");
    
    try {
      session = await window.ort.InferenceSession.create(modelUrl, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all"
      });
      console.log("✅ ONNX 모델 로드 완료");
    } catch (err) {
      console.error("❌ ONNX 모델 로드 실패:", err);
    } finally {
      modelLoading = false;
    }
  }

  // === mouse.js에서 이벤트 받기 ===
  window.realtimeMouseDetector = {
    addMouseEvent(event) {
      buffer.push(event);
      if (buffer.length > SEQ_LEN) buffer.shift();
      
      // 버퍼가 충분히 쌓이면 분석
      if (buffer.length >= 50) {  // 최소 50개 이벤트
        analyzeMouseBuffer([...buffer]);
      }
    }
  };

  // === 특징 벡터 변환 ===
  function extractMouseFeatures(events) {
    return events.map(ev => {
      let ecode = 0;
      if (ev.type === "move") ecode = 0;
      else if (["click", "up", "down"].includes(ev.type)) ecode = 1;
      else if (ev.type === "wheel") ecode = 2;

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

  // ✅ 추가: 패턴 다양성 계산
  function calculatePatternDiversity(events) {
    if (events.length < 5) return { diversity: 100, isRepetitive: false };
    
    const movements = [];
    for (let i = 1; i < events.length; i++) {
      const dx = events[i].x - events[i-1].x;
      const dy = events[i].y - events[i-1].y;
      const dist = Math.hypot(dx, dy);
      movements.push(dist);
    }
    
    // 표준편차 계산
    const mean = movements.reduce((a, b) => a + b, 0) / movements.length;
    const variance = movements.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / movements.length;
    const std = Math.sqrt(variance);
    
    return {
      diversity: std,
      isRepetitive: std < 5  // 5px 이하 변동 = 반복 패턴
    };
  }

  // ✅ 개선된 분석 함수
  async function analyzeMouseBuffer(events) {
    try {
      if (!session) {
        console.warn("⏳ 세션 준비 중...");
        await loadModel();
        return;
      }

      // 1) ONNX 추론
      const features = extractMouseFeatures(events);
      const padded = padSequence(features);

      const inputTensor = new window.ort.Tensor(
        "float32",
        Float32Array.from(padded.flat()),
        [1, SEQ_LEN, FEATURE_DIM]
      );

      const feeds = {};
      feeds[session.inputNames[0]] = inputTensor;

      const results = await session.run(feeds);
      const logits = results[session.outputNames[0]].data;

      const exp = logits.map(Math.exp);
      const sumExp = exp.reduce((a, b) => a + b, 0);
      const probs = exp.map(v => v / sumExp);

      const confidence = probs[1]; // [0]=human, [1]=macro
      
      // 2) 히스토리에 추가
      DETECTION_STATE.history.push(confidence);
      if (DETECTION_STATE.history.length > CONFIG.HISTORY_SIZE) {
        DETECTION_STATE.history.shift();
      }

      // 3) 충분한 데이터가 없으면 대기
      if (DETECTION_STATE.history.length < CONFIG.HISTORY_SIZE) {
        console.log(`🔍 [MOUSE] 데이터 수집 중... (${DETECTION_STATE.history.length}/${CONFIG.HISTORY_SIZE}) - 현재: ${(confidence * 100).toFixed(1)}%`);
        return;
      }

      // 4) 평균 계산
      const avgConfidence = DETECTION_STATE.history.reduce((a, b) => a + b) / DETECTION_STATE.history.length;
      
      // 5) 모든 예측이 임계값 이상인지 확인
      const allAboveThreshold = DETECTION_STATE.history.every(c => c >= CONFIG.CONFIDENCE_THRESHOLD);
      
      // 6) 패턴 다양성 체크
      const pattern = calculatePatternDiversity(events);
      
      console.log(`🎯 [MOUSE] 평균 확률: ${(avgConfidence * 100).toFixed(1)}% | 패턴 다양성: ${pattern.diversity.toFixed(1)}px`);

      // 7) 최종 판정
      const isMacro = allAboveThreshold && 
                      avgConfidence >= CONFIG.AVG_THRESHOLD &&
                      pattern.isRepetitive;  // 추가 조건

      if (isMacro) {
        const now = Date.now();
        
        // 8) 쿨다운 체크 (너무 자주 알림 방지)
        if (now - DETECTION_STATE.lastAlertTime > CONFIG.ALERT_COOLDOWN) {
          console.warn(`🚨 [MOUSE] 매크로 확정! 평균 ${(avgConfidence * 100).toFixed(1)}%`);
          
          chrome.runtime.sendMessage({
            kind: "MACRO_DETECTED",
            payload: {
              method: "onnx-transformer",
              confidence: avgConfidence,  // 평균값 전송
              detectionCount: CONFIG.HISTORY_SIZE,
              patternDiversity: pattern.diversity,
              timestamp: Date.now(),
              domain: window.location.hostname,
              type: "mouse"
            }
          });
          
          DETECTION_STATE.lastAlertTime = now;
          DETECTION_STATE.history = [];  // 히스토리 초기화
        } else {
          console.log(`⏱️ [MOUSE] 쿨다운 중... (${Math.round((CONFIG.ALERT_COOLDOWN - (now - DETECTION_STATE.lastAlertTime)) / 1000)}초 남음)`);
        }
      } else {
        // 디버깅용: 왜 매크로가 아닌지 출력
        if (!allAboveThreshold) {
          console.log(`✅ [MOUSE] 정상 - 일부 예측이 낮음`);
        } else if (avgConfidence < CONFIG.AVG_THRESHOLD) {
          console.log(`✅ [MOUSE] 정상 - 평균 확률 부족 (${(avgConfidence * 100).toFixed(1)}% < ${CONFIG.AVG_THRESHOLD * 100}%)`);
        } else if (!pattern.isRepetitive) {
          console.log(`✅ [MOUSE] 정상 - 패턴 다양성 충분 (${pattern.diversity.toFixed(1)}px)`);
        }
      }

    } catch (err) {
      console.error("❌ [MOUSE-ML] 분석 실패:", err);
    }
  }

  // === 초기화 ===
  await loadModel();
  console.log("🎯 마우스 매크로 탐지기 초기화 완료 ");
})();