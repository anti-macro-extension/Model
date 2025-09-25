// background.js (service worker) - 매크로 탐지 + 대시보드 통합
(() => {
  "use strict";

  // === 탐지 설정 ===
  let isDetectionEnabled = true;
  let currentDetectionStatus = {
    anomaly_score: 0,
    total_events: 0,
    analysis_time: 0,
    features: { p2p_mean: 0 },
    pattern_diversity: 1.0,
    confidence: 0
  };

  // === 탐지 통계 ===
  let detectionStats = {
    totalDetections: 0,
    sessionsActive: 0,
    lastDetectionTime: null,
    detectionHistory: [] // 최근 탐지 기록
  };

  // === 메시지 리스너 (통합) ===
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      
      // === 매크로 탐지 알림 처리 ===
      if (msg?.kind === "MACRO_DETECTED") {
        handleMacroDetection(msg.payload, sender);
        sendResponse({ ok: true });
        return true;
      }
      
      // === 세션 종료 처리 ===
      if (msg?.kind === "SESSION_END") {
        handleSessionEnd(msg.payload, sender);
        sendResponse({ ok: true });
        return true;
      }
      
      // === 통계 요청 처리 ===
      if (msg?.kind === "GET_DETECTION_STATS") {
        sendResponse({ 
          ok: true, 
          stats: getDetectionStats() 
        });
        return true;
      }

      // === 팝업 대시보드 메시지들 ===
      
      // 탐지 토글 (ON/OFF)
      if (msg?.kind === "TOGGLE_DETECTION") {
        isDetectionEnabled = msg.enabled;
        console.log('매크로 탐지 상태 변경:', isDetectionEnabled ? '활성화' : '비활성화');
        
        // 모든 활성 탭에 상태 변경 알림
        broadcastToContentScripts({
          type: 'DETECTION_TOGGLE',
          enabled: isDetectionEnabled
        });
        
        sendResponse({ ok: true });
        return true;
      }
      
      // 현재 상태 요청
      if (msg?.kind === "GET_STATUS") {
        sendResponse({ 
          ok: true, 
          status: getCurrentDetectionStatus() 
        });
        return true;
      }
      
      // 리포트 내보내기
      if (msg?.kind === "EXPORT_REPORT") {
        exportDetectionReport(msg.data);
        sendResponse({ ok: true });
        return true;
      }
      
      // 버퍼 초기화
      if (msg?.kind === "CLEAR_BUFFERS") {
        clearAllBuffers();
        sendResponse({ ok: true });
        return true;
      }
      
      // 설정 페이지 열기
      if (msg?.kind === "OPEN_SETTINGS") {
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return true;
      }
      
      // === Content Script로부터 실시간 데이터 수신 ===
      if (msg?.kind === "DETECTION_UPDATE") {
        updateDetectionStatus(msg.payload);
        sendResponse({ ok: true });
        return true;
      }
      
    } catch (error) {
      console.error("[background] 메시지 처리 오류:", error);
      sendResponse({ 
        ok: false, 
        error: String(error?.message || error) 
      });
    }
    
    return false;
  });

  // === 매크로 탐지 처리 (기존 + 배지 업데이트) ===
  function handleMacroDetection(payload, sender) {
    if (!isDetectionEnabled) return; // 탐지 비활성화 상태면 무시
    
    detectionStats.totalDetections++;
    detectionStats.lastDetectionTime = payload.timestamp;
    
    // 탐지 기록 추가
    const detection = {
      ...payload,
      tabId: sender?.tab?.id,
      tabUrl: sender?.tab?.url || payload.url,
      id: detectionStats.totalDetections
    };
    
    detectionStats.detectionHistory.push(detection);
    
    // 최대 100개 기록만 유지
    if (detectionStats.detectionHistory.length > 100) {
      detectionStats.detectionHistory.shift();
    }
    
    console.warn('🚨 매크로 탐지됨:', {
      id: detection.id,
      confidence: payload.confidence,
      domain: payload.domain,
      method: payload.method
    });
    
    // 현재 상태 업데이트
    currentDetectionStatus.anomaly_score = payload.confidence || 0;
    currentDetectionStatus.confidence = payload.confidence || 0;
    
    // 배지를 경고 상태로 변경
    if (sender?.tab?.id) {
      chrome.action.setBadgeText({ text: "⚠", tabId: sender.tab.id });
      chrome.action.setBadgeBackgroundColor({ color: "#ff6b6b", tabId: sender.tab.id });
      chrome.action.setTitle({ 
        title: `매크로 감지됨! - ${payload.domain}`, 
        tabId: sender.tab.id 
      });
      
      // 5초 후 원래 상태로 복원
      setTimeout(() => {
        chrome.action.setBadgeText({ text: "🛡", tabId: sender.tab.id });
        chrome.action.setBadgeBackgroundColor({ color: "#00a883", tabId: sender.tab.id });
      }, 5000);
    }
    
    // 팝업에 실시간 결과 전송
    sendDetectionResultToPopup(detection);
    
    // 브라우저 알림 표시
    showMacroNotification(detection);
  }

  // === 탐지 상태 업데이트 (새로 추가) ===
  function updateDetectionStatus(payload) {
    if (!isDetectionEnabled) return;
    
    currentDetectionStatus = {
      anomaly_score: payload.anomaly_score || 0,
      total_events: payload.total_events || 0,
      analysis_time: payload.analysis_time || 0,
      features: payload.features || { p2p_mean: 0 },
      pattern_diversity: payload.pattern_diversity || 1.0,
      confidence: payload.confidence || 0
    };
    
    // 팝업이 열려있으면 실시간 업데이트 전송
    sendDetectionResultToPopup(currentDetectionStatus);
  }

  // === 팝업에 탐지 결과 전송 (새로 추가) ===
  function sendDetectionResultToPopup(result) {
    try {
      chrome.runtime.sendMessage({
        type: 'DETECTION_RESULT',
        result: result
      }).catch(() => {
        // 팝업이 열려있지 않으면 무시
      });
    } catch (error) {
      // 팝업이 열려있지 않으면 무시
    }
  }

  // === 현재 탐지 상태 반환 (새로 추가) ===
  function getCurrentDetectionStatus() {
    return {
      ...currentDetectionStatus,
      isEnabled: isDetectionEnabled,
      totalDetections: detectionStats.totalDetections,
      lastUpdate: Date.now()
    };
  }

  // === 리포트 내보내기 (Service Worker 호환) ===
  function exportDetectionReport(reportData) {
    const csvData = generateReportCSV(reportData);
    
    // Service Worker에서는 URL.createObjectURL 대신 Data URL 사용
    const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvData);
    
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `macro_detection_report_${timestamp}.csv`;
    
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('리포트 다운로드 실패:', chrome.runtime.lastError.message);
      } else {
        console.log('✅ 리포트 다운로드 시작:', filename);
      }
    });
  }

  // === 리포트 CSV 생성 (새로 추가) ===
  function generateReportCSV(reportData) {
    const headers = [
      'timestamp', 'current_risk', 'total_events', 'avg_analysis_time', 
      'session_duration', 'detection_count', 'avg_confidence'
    ];
    
    const stats = getDetectionStats();
    const rows = [
      [
        reportData.timestamp,
        reportData.currentRisk,
        reportData.totalEvents,
        reportData.avgAnalysisTime,
        Math.round(reportData.sessionDuration / 1000),
        stats.totalDetections,
        stats.avgConfidenceRecent.toFixed(3)
      ]
    ];
    
    // 최근 패턴 히스토리 추가
    if (reportData.recentPatterns && reportData.recentPatterns.length > 0) {
      headers.push('recent_patterns');
      rows[0].push(reportData.recentPatterns.join(';'));
    }
    
    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  // === 모든 버퍼 초기화 (새로 추가) ===
  function clearAllBuffers() {
    // 통계 초기화
    detectionStats.totalDetections = 0;
    detectionStats.detectionHistory = [];
    detectionStats.lastDetectionTime = null;
    
    // 현재 상태 초기화
    currentDetectionStatus = {
      anomaly_score: 0,
      total_events: 0,
      analysis_time: 0,
      features: { p2p_mean: 0 },
      pattern_diversity: 1.0,
      confidence: 0
    };
    
    // 모든 활성 탭에 버퍼 초기화 명령 전송
    broadcastToContentScripts({
      type: 'CLEAR_BUFFERS'
    });
    
    console.log('모든 탐지 데이터 초기화됨');
  }

  // === Content Script들에게 메시지 브로드캐스트 (새로 추가) ===
  async function broadcastToContentScripts(message) {
    try {
      const tabs = await chrome.tabs.query({ 
        url: ["http://*/*", "https://*/*"] 
      });
      
      for (const tab of tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, message);
        } catch (error) {
          // 일부 탭에서 실패는 정상 (스크립트가 주입되지 않은 탭 등)
        }
      }
    } catch (error) {
      console.error('브로드캐스트 실패:', error);
    }
  }

  // === 브라우저 알림 표시 (기존) ===
  function showMacroNotification(detection) {
    const confidencePercent = Math.round(detection.confidence * 100);
    const domain = detection.domain || 'Unknown';
    
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="red"/><text x="32" y="40" text-anchor="middle" fill="white" font-size="24">!</text></svg>',
      title: '매크로 활동 탐지',
      message: `사이트: ${domain}\n신뢰도: ${confidencePercent}%\n방법: ${detection.method === 'model' ? 'AI 모델' : '규칙 기반'}\n시간: ${new Date(detection.timestamp).toLocaleTimeString()}`,
      priority: 2
    }, (notificationId) => {
      if (chrome.runtime.lastError) {
        console.error('알림 생성 실패:', chrome.runtime.lastError.message);
      } else {
        console.log('매크로 탐지 알림 표시:', notificationId);
      }
    });
  }

  // === 세션 종료 처리 (기존) ===
  function handleSessionEnd(payload, sender) {
    console.log('세션 종료:', {
      url: payload.url,
      duration: Math.round(payload.sessionDuration / 1000) + '초',
      totalKeystrokes: payload.stats?.totalKeystrokes || 0,
      detections: payload.stats?.detections || 0
    });
    
    if (detectionStats.sessionsActive > 0) {
      detectionStats.sessionsActive--;
    }
  }

  // === 통계 정보 반환 (기존) ===
  function getDetectionStats() {
    const now = Date.now();
    const recentDetections = detectionStats.detectionHistory.filter(
      d => now - d.timestamp < 3600000 // 최근 1시간
    );
    
    return {
      totalDetections: detectionStats.totalDetections,
      recentDetections: recentDetections.length,
      lastDetectionTime: detectionStats.lastDetectionTime,
      sessionsActive: detectionStats.sessionsActive,
      recentHistory: detectionStats.detectionHistory.slice(-10), // 최근 10개
      avgConfidenceRecent: recentDetections.length > 0 ? 
        recentDetections.reduce((sum, d) => sum + d.confidence, 0) / recentDetections.length : 0
    };
  }

  // === 확장 프로그램 설치/업데이트 시 처리 (기존) ===
  chrome.runtime.onInstalled.addListener((details) => {
    console.log('매크로 탐지기 설치됨:', details.reason);
    
    if (details.reason === 'install') {
      console.log('첫 설치: 매크로 탐지 시스템 초기화');
      showInstallNotification();
    } else if (details.reason === 'update') {
      console.log('업데이트: 버전', details.previousVersion, '→', chrome.runtime.getManifest().version);
    }
    
    // 확장 프로그램 아이콘 초기화
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#4b3cc4" });
    
    // 기존 탭들에 스크립트 재주입 (필요한 경우)
    reinjectScriptsToExistingTabs();
  });

  // === 설치 완료 알림 ===
  function showInstallNotification() {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="%234b3cc4"/><text x="32" y="40" text-anchor="middle" fill="white" font-size="24">🛡</text></svg>',
      title: '매크로 탐지 시스템 설치 완료',
      message: '실시간 매크로 탐지가 활성화되었습니다. 웹사이트에서 자동으로 작동합니다.',
      priority: 1
    });
  }

  // === 탭 활동 모니터링 (상시 활성화) ===
  
  // 탭 업데이트 감지 (페이지 로드, URL 변경)
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
      console.log('📄 페이지 로드 완료:', tab.url);
      updateBadgeForActiveTab(tabId, tab.url);
    }
  });
  
  // 탭 활성화 감지
  chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
      if (tab.url && !tab.url.startsWith('chrome://')) {
        console.log('🔄 탭 활성화:', tab.url);
        updateBadgeForActiveTab(activeInfo.tabId, tab.url);
      }
    });
  });
  
  // 탭별 배지 업데이트
  function updateBadgeForActiveTab(tabId, url) {
    const domain = new URL(url).hostname;
    const isMonitored = isMonitoredSite(domain);
    
    if (isMonitored) {
      chrome.action.setBadgeText({ text: "🛡", tabId: tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#00a883", tabId: tabId });
      chrome.action.setTitle({ 
        title: `매크로 탐지 활성 - ${domain}`, 
        tabId: tabId 
      });
    } else {
      chrome.action.setBadgeText({ text: "", tabId: tabId });
      chrome.action.setTitle({ 
        title: "매크로 탐지 시스템 (비활성)", 
        tabId: tabId 
      });
    }
  }
  
  // 모니터링 대상 사이트 확인
  function isMonitoredSite(domain) {
    const monitoredDomains = [
      'ticket.interpark.com',
      'tickets.yes24.com', 
      'ticketlink.co.kr',
      'melon.com',
      'gmarket.co.kr',
      '11st.co.kr',
      'coupang.com',
      'localhost' // 테스트용
    ];
    
    return monitoredDomains.some(monitored => 
      domain.includes(monitored) || monitored.includes(domain)
    ) || domain.includes('ticket') || domain.includes('shop');
  }
  async function reinjectScriptsToExistingTabs() {
    try {
      const tabs = await chrome.tabs.query({ 
        url: ["http://*/*", "https://*/*"] 
      });
      
      for (const tab of tabs) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["realtime_keyboard_macro.js", "keyboard.js"]
          });
          console.log(`스크립트 재주입 성공: ${tab.url}`);
          detectionStats.sessionsActive++;
        } catch (error) {
          // 특정 탭에서 주입 실패는 정상 (chrome:// 페이지 등)
          console.debug(`스크립트 주입 실패: ${tab.url}`, error.message);
        }
      }
    } catch (error) {
      console.error('스크립트 재주입 중 오류:', error);
    }
  }

  // === 알림 클릭 처리 (기존) ===
  chrome.notifications.onClicked.addListener((notificationId) => {
    console.log('매크로 탐지 알림 클릭됨:', notificationId);
    chrome.notifications.clear(notificationId);
  });

  // === 주기적 상태 업데이트 (새로 추가) ===
  setInterval(() => {
    if (isDetectionEnabled) {
      // 팝업에 카운트 업데이트 전송
      try {
        chrome.runtime.sendMessage({
          type: 'COUNT_UPDATE',
          count: currentDetectionStatus.total_events
        }).catch(() => {
          // 팝업이 열려있지 않으면 무시
        });
      } catch (error) {
        // 팝업이 열려있지 않으면 무시
      }
    }
  }, 2000);

  // === 시작 로그 ===
  console.log('🛡️ 매크로 탐지 백그라운드 서비스 시작됨 (상시 활성화)');
  console.log('🎯 탐지 상태:', isDetectionEnabled ? '활성화' : '비활성화');
  console.log('📱 이벤트 모니터링: 탭 변경, 페이지 로드, 매크로 탐지');

})();