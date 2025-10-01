// === realtime_keyboard_macro.js (실제 모델 연동 버전) ===
(() => {
  "use strict";
  
  console.log('[MACRO-DETECTOR] 실제 ML 모델 연동 매크로 탐지기 로드 시작');

  // === 탐지 설정 ===
  const DETECTION_CONFIG = {
    ANALYSIS_WINDOW: 20,
    MIN_KEYS_FOR_ANALYSIS: 10,
    UPDATE_INTERVAL: 5,
    MACRO_THRESHOLD: 0.5,
    HIGH_CONFIDENCE: 0.8,
    CONSOLE_LOG: true
  };

  // === 데이터 저장소 ===
  let keyEvents = [];
  let analysisResults = [];
  let currentScore = 0;
  let detectionCount = 0;
  let realMLDetector = null; // 실제 ML 모델 인스턴스

  // === 유틸리티 함수 ===
  const log = (...args) => DETECTION_CONFIG.CONSOLE_LOG && console.log('[MACRO-ML]', ...args);
  const now = () => performance.now();

  // 통계 계산 함수들
  const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const std = (arr) => {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    const variance = arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / arr.length;
    return Math.sqrt(variance);
  };
  const min = (arr) => arr.length ? Math.min(...arr) : 0;
  const max = (arr) => arr.length ? Math.max(...arr) : 0;

  // === 실제 ML 모델 연동 매크로 탐지 클래스 ===
  class MacroDetectorML {
    constructor() {
      this.reset();
      this.initializeRealModel();
    }

    reset() {
      keyEvents.length = 0;
      analysisResults.length = 0;
      currentScore = 0;
      detectionCount = 0;
    }

    // 실제 ML 모델 초기화
    initializeRealModel() {
      // RealMacroDetector가 로드될 때까지 대기
      if (window.RealMacroDetector) {
        realMLDetector = new window.RealMacroDetector();
        log('✅ 실제 ML 모델 연동 완료:', realMLDetector.getModelInfo());
      } else {
        // 폴링으로 모델 로드 대기
        let attempts = 0;
        const maxAttempts = 10;
        
        const checkModel = () => {
          attempts++;
          if (window.RealMacroDetector) {
            realMLDetector = new window.RealMacroDetector();
            log('✅ 실제 ML 모델 연동 완료 (지연 로드):', realMLDetector.getModelInfo());
          } else if (attempts < maxAttempts) {
            setTimeout(checkModel, 500);
          } else {
            log('⚠️ 실제 ML 모델 로드 실패 - 규칙 기반 탐지 사용');
          }
        };
        
        checkModel();
      }
    }

    // 키 이벤트 추가
    addKeyEvent(event) {
      const timestamp = now();
      
      const keyData = {
        key: event.key,
        code: event.code,
        type: event.type,
        timestamp: timestamp,
        processed: false
      };

      keyEvents.push(keyData);

      // 오래된 데이터 제거
      if (keyEvents.length > DETECTION_CONFIG.ANALYSIS_WINDOW * 3) {
        keyEvents = keyEvents.slice(-DETECTION_CONFIG.ANALYSIS_WINDOW * 2);
      }

      // 정기적으로 분석 수행
      if (keyEvents.length % DETECTION_CONFIG.UPDATE_INTERVAL === 0) {
        this.performAnalysis();
      }
    }

    // 특성 추출 (기존 로직)
    extractFeatures() {
      if (keyEvents.length < DETECTION_CONFIG.MIN_KEYS_FOR_ANALYSIS) {
        return null;
      }

      const recentEvents = keyEvents.slice(-DETECTION_CONFIG.ANALYSIS_WINDOW);
      const keyDownEvents = recentEvents.filter(e => e.type === 'keydown');
      if (keyDownEvents.length < 3) return null;

      // P2P (Press-to-Press) 간격 계산
      const p2pIntervals = [];
      for (let i = 1; i < keyDownEvents.length; i++) {
        const interval = (keyDownEvents[i].timestamp - keyDownEvents[i-1].timestamp) / 1000;
        if (interval > 0 && interval < 10) {
          p2pIntervals.push(interval);
        }
      }

      if (p2pIntervals.length < 2) return null;

      // Dwell time 계산
      const dwellTimes = [];
      for (let i = 0; i < recentEvents.length - 1; i++) {
        const current = recentEvents[i];
        const next = recentEvents[i + 1];
        
        if (current.type === 'keydown' && next.type === 'keyup' && 
            current.key === next.key) {
          const dwell = (next.timestamp - current.timestamp) / 1000;
          if (dwell > 0 && dwell < 1) {
            dwellTimes.push(dwell);
          }
        }
      }

      if (dwellTimes.length === 0) {
        dwellTimes.push(0.05); // 50ms 기본값
      }

      // 특성 계산
      const features = [
        mean(p2pIntervals),  // p2p_mean
        std(p2pIntervals),   // p2p_std
        min(p2pIntervals),   // p2p_min
        max(p2pIntervals),   // p2p_max
        mean(dwellTimes),    // dwell_mean
        std(dwellTimes)      // dwell_std
      ];

      return {
        features: features,
        raw_data: {
          p2p_intervals: p2pIntervals,
          dwell_times: dwellTimes,
          key_count: keyDownEvents.length
        }
      };
    }

    // 메인 분석 함수 (실제 ML 모델 사용)
    performAnalysis() {
      const extracted = this.extractFeatures();
      if (!extracted) return;

      const { features, raw_data } = extracted;
      let result;

      // === 실제 ML 모델 사용 ===
      if (realMLDetector) {
        try {
          // 실제 ML 모델로 예측
          const mlResult = realMLDetector.detectMacro(features);
          
          result = {
            timestamp: now(),
            features: features,
            macro_probability: mlResult.probability,
            confidence: mlResult.confidence,
            raw_data: raw_data,
            is_macro: mlResult.probability > DETECTION_CONFIG.MACRO_THRESHOLD,
            method: 'real_ml_model',
            model_info: mlResult.model_type,
            model_accuracy: mlResult.accuracy
          };

          log(`🎯 실제 ML 모델 분석: ${(mlResult.probability * 100).toFixed(1)}% (${mlResult.model_type})`);

        } catch (error) {
          log('⚠️ 실제 ML 모델 오류, 백업 로직 사용:', error);
          result = this.fallbackAnalysis(features, raw_data);
        }
      } else {
        // 백업: 규칙 기반 분석
        result = this.fallbackAnalysis(features, raw_data);
      }

      analysisResults.push(result);
      currentScore = result.macro_probability;

      if (result.macro_probability > DETECTION_CONFIG.MACRO_THRESHOLD) {
        detectionCount++;
        this.reportMacroDetection(result);
      }

      if (analysisResults.length > 50) {
        analysisResults = analysisResults.slice(-30);
      }
    }

    // 백업 분석 (기존 규칙 기반)
    fallbackAnalysis(features, raw_data) {
      const [p2p_mean, p2p_std, p2p_min, p2p_max, dwell_mean, dwell_std] = features;
      
      let score = 0.0;
      
      // 간단한 규칙들
      if (p2p_std < 0.02) score += 0.4;
      if (p2p_mean < 0.1) score += 0.3;
      if (dwell_std < 0.005) score += 0.2;
      if (p2p_max - p2p_min < 0.05) score += 0.1;
      
      const probability = Math.max(0, Math.min(1, score));
      
      return {
        timestamp: now(),
        features: features,
        macro_probability: probability,
        confidence: Math.abs(probability - 0.5) * 2,
        raw_data: raw_data,
        is_macro: probability > DETECTION_CONFIG.MACRO_THRESHOLD,
        method: 'fallback_rules'
      };
    }

    // 매크로 탐지 보고
    reportMacroDetection(result) {
      const confidence = result.macro_probability > DETECTION_CONFIG.HIGH_CONFIDENCE ? 'high' : 'medium';
      
      console.warn('🚨 매크로 탐지!', {
        '확률': `${(result.macro_probability * 100).toFixed(1)}%`,
        '신뢰도': confidence,
        '모델': result.method,
        '시간': new Date().toLocaleTimeString()
      });

      this.notifyBackground(result);
    }

    // 백그라운드 알림
    notifyBackground(result) {
      if (typeof chrome !== "undefined" && chrome?.runtime?.id) {
        try {
          chrome.runtime.sendMessage({
            type: 'MACRO_DETECTION_ML',
            data: {
              probability: result.macro_probability,
              confidence: result.macro_probability > DETECTION_CONFIG.HIGH_CONFIDENCE ? 'high' : 'medium',
              timestamp: result.timestamp,
              features: result.features,
              method: result.method,
              model_info: result.model_info,
              accuracy: result.model_accuracy
            }
          }, () => void chrome.runtime.lastError);
        } catch (e) {
          log('백그라운드 알림 실패:', e);
        }
      }
    }

    // 상태 조회
    getStatus() {
      return {
        currentScore: currentScore,
        detectionCount: detectionCount,
        totalAnalyses: analysisResults.length,
        keyEventCount: keyEvents.length,
        lastAnalysis: analysisResults[analysisResults.length - 1],
        isActive: keyEvents.length >= DETECTION_CONFIG.MIN_KEYS_FOR_ANALYSIS,
        realModelLoaded: realMLDetector !== null,
        modelInfo: realMLDetector ? realMLDetector.getModelInfo() : null
      };
    }

    getDetailedResults(limit = 10) {
      return analysisResults.slice(-limit);
    }
  }

  // === 탐지기 인스턴스 생성 ===
  const detector = new MacroDetectorML();

  // === keyboard.js와 연동을 위한 글로벌 인터페이스 ===
  window.realtimeMacroDetector = {
    // keyboard.js에서 호출할 메서드
    processKeyEvent: function(keyData) {
      detector.addKeyEvent(keyData);
    },
    
    // 설정 업데이트
    updateConfig: function(config) {
      if (config.enabled !== undefined) {
        // 설정 업데이트 로직
      }
      console.log('매크로 탐지기 설정 업데이트:', config);
    },
    
    // 통계 조회
    getStats: function() {
      return detector.getStatus();
    },
    
    // 데이터 초기화
    clearData: function() {
      detector.reset();
      console.log('🗑️ 매크로 탐지기 데이터 초기화됨');
    },
    
    // 상태 확인
    isReady: function() {
      return detector !== null;
    }
  };

  // === 이벤트 리스너 설정 (백업용) ===
  document.addEventListener('keydown', (event) => {
    detector.addKeyEvent({
      type: event.type,
      key: event.key,
      code: event.code,
      timestamp: Date.now()
    });
  }, true);

  document.addEventListener('keyup', (event) => {
    detector.addKeyEvent({
      type: event.type,
      key: event.key,
      code: event.code,
      timestamp: Date.now()
    });
  }, true);

  log('🎯 실제 ML 모델 연동 매크로 탐지기 초기화 완료');
  console.log('[MACRO-DETECTOR] 실제 ML 모델 기반 탐지기 로드 완료');

})();