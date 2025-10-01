// === mouse_logger.js ===
let collectedEvents = [];

function logEvent(e, type) {
  const ev = {
    timestamp: Date.now(),
    x: e.clientX ?? null,
    y: e.clientY ?? null,
    type,
    deltaY: type === "wheel" ? e.deltaY : 0
  };
  collectedEvents.push(ev);
  console.log("🖱️ LOG:", ev);
}

// CSV 저장 요청 → background.js
function saveEventsToCSV(events) {
  if (!events.length) {
    console.warn("⚠️ 저장할 이벤트 없음");
    return;
  }

  const headers = ["timestamp", "x", "y", "type", "deltaY"];
  const rows = events.map(ev => [
    ev.timestamp,
    ev.x,
    ev.y,
    ev.type,
    ev.deltaY || 0
  ]);
  const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");

  chrome.runtime.sendMessage({
    kind: "SAVE_CSV",
    filename: "mouse_events.csv",
    content: csvContent
  });

  console.log("📤 저장 요청 전송:", events.length, "줄");
}

// 이벤트 리스너 등록
document.addEventListener("mousemove", e => logEvent(e, "move"));
document.addEventListener("mousedown", e => logEvent(e, "down"));
document.addEventListener("mouseup", e => logEvent(e, "up"));
document.addEventListener("wheel", e => logEvent(e, "wheel"));

// F10 → 저장
document.addEventListener("keydown", e => {
  if (e.key === "F10") {
    saveEventsToCSV(collectedEvents);
    collectedEvents = []; // 저장 후 비우기
  }
});
