// === popup/script.js (매크로 탐지 대시보드) ===

// HTML 요소 연결
const riskDisplay = document.getElementById('riskDisplay');
const riskPercentage = document.getElementById('riskPercentage');
const riskLabel = document.getElementById('riskLabel');
const riskDesc = document.getElementById('riskDesc');
const progressFill = document.getElementById('progressFill');
const eventsCount = document.getElementById('eventsCount');
const analysisTime = document.getElementById('analysisTime');
const avgSpeed = document.getElementById('avgSpeed');
const patternScore = document.getElementById('patternScore');
const toggleBtn = document.getElementById('toggleDetection');
const exportBtn = document.getElementById('exportReport');
const resetBtn = document.getElementById('resetData');
const settingsBtn = document.getElementById('settings');
const alertContainer = document.getElementById('alertContainer');

// 상태 변수들
let isDetecting = true;
let currentRisk = 3;
let totalEvents = 0;
let lastAnalysisTime = 0;
let recentPatterns = [];

// Chrome Extension 메시지 전송 헬퍼
function sendMessage(msg, cb) {
  if (!chrome?.runtime?.id) {
    showAlert("확장 프로그램 컨텍스트가 아닙니다", 'danger');
    return;
  }
  chrome.runtime.sendMessage(msg, (resp) => {
    const err = chrome.runtime.lastError?.message;
    if (err) {
      showAlert("메시지 오류: " + err, 'danger');
      return;
    }
    cb && cb(resp);
  });
}

// 위험도 업데이트 함수
function updateRiskLevel(risk) {
  currentRisk = Math.max(0, Math.min(100, Math.round(risk)));
  riskPercentage.textContent = currentRisk + '%';
  progressFill.style.width = currentRisk + '%';
  
  // 위험도별 스타일 및 메시지
  riskDisplay.className = 'risk-display';
  if (currentRisk <= 15) {
    riskDisplay.classList.add('safe');
    riskLabel.textContent = '안전';
    riskDesc.textContent = '정상적인 사용자 패턴';
  } else if (currentRisk <= 50) {
    riskDisplay.classList.add('warning');
    riskLabel.textContent = '주의';
    riskDesc.textContent = '의심스러운 패턴 감지';
    if (currentRisk > 30) {
      showAlert('⚠️ 주의: 비정상 패턴 감지됨', 'warning');
    }
  } else {
    riskDisplay.classList.add('danger');
    riskLabel.textContent = '위험';
    riskDesc.textContent = '매크로 사용 가능성 높음';
    if (currentRisk > 70) {
      showAlert('🚨 위험: 매크로 활동 의심됨!', 'danger');
    }
  }
}

// 알림 표시 함수
function showAlert(message, type = 'success') {
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.textContent = message;
  alertContainer.appendChild(alert);
  
  // 기존 알림이 5개 이상이면 오래된 것 제거
  const alerts = alertContainer.children;
  if (alerts.length > 3) {
    alertContainer.removeChild(alerts[0]);
  }
  
  setTimeout(() => {
    if (alert.parentNode) {
      alert.parentNode.removeChild(alert);
    }
  }, 4000);
}

// 통계 업데이트 함수
function updateStats(stats) {
  if (stats.eventCount !== undefined) {
    totalEvents = stats.eventCount;
    eventsCount.textContent = totalEvents;
  }
  
  if (stats.analysisTime !== undefined) {
    lastAnalysisTime = stats.analysisTime;
    analysisTime.textContent = stats.analysisTime.toFixed(1) + 's';
  }
  
  if (stats.avgSpeed !== undefined) {
    avgSpeed.textContent = Math.round(stats.avgSpeed) + 'ms';
  }
  
  if (stats.patternScore !== undefined) {
    patternScore.textContent = stats.patternScore.toFixed(2);
  }
}

// 매크로 탐지 결과 처리
function handleDetectionResult(result) {
  if (!result || !isDetecting) return;
  
  // 위험도 업데이트 (모델의 anomaly_score를 0-100 스케일로 변환)
  const riskScore = Math.min(100, (result.anomaly_score || 0) * 100);
  updateRiskLevel(riskScore);
  
  // 통계 업데이트
  updateStats({
    eventCount: result.total_events || totalEvents,
    analysisTime: result.analysis_time || lastAnalysisTime,
    avgSpeed: result.features?.p2p_mean || null,
    patternScore: result.pattern_diversity || Math.random() * 0.3 + 0.7
  });
  
  // 패턴 히스토리 저장 (최근 10개)
  recentPatterns.push(riskScore);
  if (recentPatterns.length > 10) {
    recentPatterns.shift();
  }
  
  // 급격한 위험도 변화 감지
  if (recentPatterns.length >= 3) {
    const recent = recentPatterns.slice(-3);
    const avgRecent = recent.reduce((a, b) => a + b) / recent.length;
    if (avgRecent > 50 && result.confidence > 0.8) {
      showAlert('📊 지속적인 매크로 패턴 감지됨', 'danger');
    }
  }
}

// 버튼 이벤트 리스너들
toggleBtn?.addEventListener('click', () => {
  isDetecting = !isDetecting;
  toggleBtn.textContent = isDetecting ? '감지 일시정지' : '감지 시작';
  toggleBtn.className = isDetecting ? 'btn btn-primary' : 'btn btn-success';
  
  // 시뮬레이션 제어
  if (isDetecting) {
    startSimulation();
  } else {
    stopSimulation();
  }
  
  // Background script에 상태 변경 알림
  sendMessage({ 
    kind: 'TOGGLE_DETECTION', 
    enabled: isDetecting 
  }, (resp) => {
    if (resp?.ok) {
      showAlert(isDetecting ? '✅ 매크로 감지 시작됨' : '⏸️ 매크로 감지 일시정지됨', 
                isDetecting ? 'success' : 'warning');
    }
  });
});

exportBtn?.addEventListener('click', () => {
  const reportData = {
    timestamp: new Date().toISOString(),
    currentRisk: currentRisk,
    totalEvents: totalEvents,
    avgAnalysisTime: lastAnalysisTime,
    recentPatterns: recentPatterns,
    sessionDuration: Date.now() - sessionStartTime
  };
  
  // CSV 형태로 리포트 내보내기
  sendMessage({ 
    kind: 'EXPORT_REPORT', 
    data: reportData 
  }, (resp) => {
    if (resp?.ok) {
      showAlert('📄 탐지 리포트 다운로드 완료', 'success');
    } else {
      showAlert('리포트 내보내기 실패: ' + (resp?.error || '알 수 없는 오류'), 'danger');
    }
  });
});

resetBtn?.addEventListener('click', () => {
  if (confirm('모든 수집 데이터를 초기화하시겠습니까?')) {
    sendMessage({ kind: 'CLEAR_BUFFERS' }, (resp) => {
      if (resp?.ok) {
        // UI 초기화
        totalEvents = 0;
        currentRisk = 0;
        recentPatterns = [];
        
        updateRiskLevel(0);
        updateStats({
          eventCount: 0,
          analysisTime: 0,
          avgSpeed: 0,
          patternScore: 1.0
        });
        
        // 알림 컨테이너도 비우기
        alertContainer.innerHTML = '';
        showAlert('🗑️ 모든 데이터가 초기화됨', 'success');
        
        // 시뮬레이션 재시작
        if (isDetecting) {
          stopSimulation();
          startSimulation();
        }
      }
    });
  }
});

settingsBtn?.addEventListener('click', () => {
  // 설정 페이지 열기 (chrome.runtime.openOptionsPage 또는 새 탭)
  sendMessage({ kind: 'OPEN_SETTINGS' }, (resp) => {
    showAlert('⚙️ 설정 페이지로 이동', 'success');
  });
});

// Background script로부터 메시지 수신
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'DETECTION_RESULT':
      handleDetectionResult(msg.result);
      break;
      
    case 'COUNT_UPDATE':
      updateStats({ eventCount: msg.count });
      break;
      
    case 'ANALYSIS_UPDATE':
      if (msg.analysisTime) {
        updateStats({ analysisTime: msg.analysisTime });
      }
      break;
      
    case 'RISK_ALERT':
      showAlert(msg.message, msg.level || 'warning');
      break;
      
    default:
      break;
  }
});

// 초기화 및 상태 복원
const sessionStartTime = Date.now();

// 저장된 상태 복원
chrome.storage.local.get({
  isDetecting: true,
  totalEvents: 0,
  currentRisk: 0
}, (result) => {
  isDetecting = result.isDetecting;
  totalEvents = result.totalEvents;
  currentRisk = result.currentRisk;
  
  toggleBtn.textContent = isDetecting ? '감지 일시정지' : '감지 시작';
  toggleBtn.className = isDetecting ? 'btn btn-primary' : 'btn btn-success';
  
  updateRiskLevel(currentRisk);
  updateStats({ eventCount: totalEvents });
  
  // 시뮬레이션 시작 제어
  if (isDetecting) {
    startSimulation();
  }
});

// 현재 상태 요청
sendMessage({ kind: 'GET_STATUS' }, (resp) => {
  if (resp?.ok) {
    handleDetectionResult(resp.status);
  }
});

// 주기적으로 상태 업데이트 요청 (5초마다)
setInterval(() => {
  if (isDetecting) {
    sendMessage({ kind: 'GET_STATUS' }, (resp) => {
      if (resp?.ok) {
        handleDetectionResult(resp.status);
      }
    });
  }
}, 5000);

// 팝업 종료 시 상태 저장 및 정리
window.addEventListener('beforeunload', () => {
  chrome.storage.local.set({
    isDetecting: isDetecting,
    totalEvents: totalEvents,
    currentRisk: currentRisk
  });
  
  // 시뮬레이션 정리
  stopSimulation();
});

// 초기 환영 메시지
setTimeout(() => {
  showAlert('🛡️ 매크로 탐지 시스템 활성화됨', 'success');
}, 500);

// === 시뮬레이션 코드 (실제 구현 전까지) ===
let simulationInterval;

function startSimulation() {
  if (simulationInterval) return;
  
  simulationInterval = setInterval(() => {
    if (!isDetecting) return;
    
    // 랜덤한 위험도 변화 시뮬레이션
    const change = (Math.random() - 0.5) * 4;
    const newRisk = Math.max(0, Math.min(100, currentRisk + change));
    updateRiskLevel(Math.round(newRisk));
    
    // 이벤트 카운트 증가
    totalEvents += Math.floor(Math.random() * 5) + 1;
    updateStats({ eventCount: totalEvents });
    
    // 랜덤 알림
    if (Math.random() < 0.08) {
      if (currentRisk > 50) {
        showAlert('⚠️ 높은 위험도 감지됨', 'danger');
      } else if (currentRisk > 15) {
        showAlert('👀 패턴 변화 감지', 'warning');
      }
    }
  }, 1500);
}

function stopSimulation() {
  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
  }
}