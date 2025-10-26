console.log("[DEBUG] injector.js loaded ✅");

const script = document.createElement("script");
script.src = chrome.runtime.getURL("libs/ort.min.js"); // ✅ UMD 빌드
script.onload = function() {
  console.log("[DEBUG] ort.min.js injected, window.ort =", window.ort);
};
(document.head || document.documentElement).appendChild(script);
