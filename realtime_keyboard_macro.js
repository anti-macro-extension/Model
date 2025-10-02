// realtime_keyboard_macro.js (ONNX 버전)
(async () => {
  "use strict";
  
  console.log("⌨️ [KEYBOARD-ONNX] 로드 시작");
  
  let session = null;
  let keyEvents = [];
  const ANALYSIS_WINDOW = 20;
  const MIN_KEYS = 10;
  
  // === ONNX 모델 로드 ===
  async function loadModel() {
    if (session) return;
    
    console.log("🔧 키보드 ONNX 모델 로드 시작...");
    
    const modelUrl = chrome.runtime.getURL("models/keyboard_macro_detector.onnx");
    
    try {
      session = await window.ort.InferenceSession.create(modelUrl, {
        executionProviders: ["wasm"]
      });
      console.log("✅ 키보드 ONNX 모델 로드 완료");
    } catch (err) {
      console.error("❌ 키보드 모델 로드 실패:", err);
    }
  }
  
  // === 특성 추출 ===
  function extractFeatures(events) {
    const keyDownEvents = events.filter(e => e.type === 'keydown');
    
    if (keyDownEvents.length < 2) return null;
    
    // Press-to-Press 간격 계산
    const p2pIntervals = [];
    for (let i = 1; i < keyDownEvents.length; i++) {
      const interval = (keyDownEvents[i].timestamp - keyDownEvents[i-1].timestamp) / 1000;
      p2pIntervals.push(interval);
    }
    
    // Dwell Time 계산 (keydown → keyup)
    const dwellTimes = keyDownEvents.map(down => {
      const up = events.find(e => 
        e.type === 'keyup' && 
        e.code === down.code && 
        e.timestamp > down.timestamp
      );
      return up ? (up.timestamp - down.timestamp) / 1000 : 0.05;
    });
    
    // 통계 함수
    const mean = arr => arr.reduce((a,b) => a+b, 0) / arr.length;
    const std = arr => {
      if (arr.length < 2) return 0;
      const m = mean(arr);
      const variance = arr.reduce((a,b) => a + Math.pow(b-m, 2), 0) / arr.length;
      return Math.sqrt(variance);
    };
    
    return [
      mean(p2pIntervals),
      std(p2pIntervals),
      Math.min(...p2pIntervals),
      Math.max(...p2pIntervals),
      mean(dwellTimes),
      std(dwellTimes)
    ];
  }
  
  // === ONNX 추론 ===
  async function analyzeKeyboard() {
    if (!session || keyEvents.length < MIN_KEYS) return;
    
    try {
      const features = extractFeatures(keyEvents);
      if (!features) return;
      
      console.log("🔍 [KEYBOARD] 특성:", features.map(f => f.toFixed(4)));
      
      // Tensor 생성 (배치 크기 1, 특성 6개)
      const inputTensor = new window.ort.Tensor(
        "float32",
        Float32Array.from(features),
        [1, 6]
      );
      
      const feeds = {};
      feeds[session.inputNames[0]] = inputTensor;
      
      // 추론 실행
      const results = await session.run(feeds);
      const logits = results[session.outputNames[0]].data;
      
      // Softmax 계산
      const exp = [Math.exp(logits[0]), Math.exp(logits[1])];
      const sumExp = exp[0] + exp[1];
      const probs = [exp[0] / sumExp, exp[1] / sumExp];
      
      const confidence = probs[1]; // [0]=human, [1]=macro
      
      console.log("⌨️ [KEYBOARD-ML] 매크로 확률:", (confidence * 100).toFixed(1) + "%");
      
      // background.js로 전송
      chrome.runtime.sendMessage({
        kind: "MACRO_DETECTED",
        payload: {
          method: "onnx-mlp",
          confidence,
          timestamp: Date.now(),
          domain: window.location.hostname,
          type: "keyboard"
        }
      });
      
    } catch (err) {
      console.error("❌ [KEYBOARD] 분석 실패:", err);
    }
  }
  
  // === 글로벌 인터페이스 (keyboard.js와 연동) ===
  window.realtimeMacroDetector = {
    processKeyEvent(event) {
      keyEvents.push(event);
      
      // 오래된 이벤트 제거
      if (keyEvents.length > ANALYSIS_WINDOW) {
        keyEvents.shift();
      }
      
      // 10개 이상 쌓이면 분석
      if (keyEvents.length >= MIN_KEYS) {
        analyzeKeyboard();
      }
    },
    
    getStats() {
      return {
        keyEventCount: keyEvents.length,
        modelLoaded: session !== null,
        modelType: "onnx-mlp"
      };
    },
    
    clearData() {
      keyEvents = [];
      console.log("🗑️ 키보드 데이터 초기화");
    },
    
    isReady() {
      return session !== null;
    }
  };
  
  // === 초기화 ===
  await loadModel();
  console.log("⌨️ 키보드 매크로 탐지기 초기화 완료 (ONNX)");
  
})();