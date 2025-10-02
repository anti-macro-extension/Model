# Mouse Macro Detector (Chrome Extension)

브라우저에서 **마우스 매크로를 실시간 탐지**하는 Chrome 확장 프로그램  
PyTorch로 학습한 Transformer 모델을 **ONNX Runtime Web**으로 변환해 실행한다.  

---

## 모델 위치
models/mouse_transformer_fixed.onnx

## 모델 특이사항
- 좌표는 **0~1 정규화**: `(x / window.innerWidth, y / window.innerHeight)`
- 학습/실행 코드 모두 동일하게 정규화 처리
- 클래스 불균형 대응: `CrossEntropyLoss(weight=[1.0, 5.0])` 적용

---

## 📦 환경 확인
```bash
node -v
npm -v
npm install onnxruntime-web@1.15.1
