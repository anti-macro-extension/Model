# Mouse Macro Detector (Chrome Extension)

> Chrome 확장 기반 **매크로(자동화 스크립트) 탐지 모델**  
> 이 저장소는 `anti-macro-extension` 프로젝트의 **AI 탐지 모델 및 추론 코드(Model Layer)** 를 포함합니다.

---

## 프로젝트 개요

현대 웹 환경에서는 티켓팅, 한정 판매, 이벤트 응모 등에서 **매크로(bot)** 사용이 빠르게 증가하고 있습니다.  
본 프로젝트는 **마우스/키보드 이벤트의 실시간 분석**을 통해 사용자가 매크로를 사용 중인지 여부를 판단하는  
AI 모델과 그 **ONNX Runtime Web 기반 추론 코드**를 제공합니다.

- **실시간 탐지 대상:** 마우스 및 키보드 입력 이벤트  
- **탐지 기준:** 속도 변동(vVar), 경로 직선성(linearity), 클릭 간격 변동(CV), 지터율(jitter ratio)  
- **탐지 임계값:** `score ≥ 0.8` → 매크로 의심 (아이콘에 `!` 경고 배지 표시)

---

## 📂 폴더 구조

```
Model/
├── libs/                     # 보조 라이브러리
├── models/
│   └── mouse_transformer_fixed.onnx   # 변환된 ONNX 모델
├── popup/                    # 확장 프로그램 팝업 UI
├── background.js             # 확장 백그라운드 스크립트
├── keyboard.js               # 키보드 이벤트 수집
├── mouse.js                  # 마우스 이벤트 수집
├── realtime_keyboard_macro.js# 실시간 키보드 매크로 탐지
├── realtime_mouse_macro.js   # 실시간 마우스 매크로 탐지
├── manifest.json             # Chrome 확장 설정
├── package.json              # Node 패키지 메타데이터
└── README.md                 # (현재 문서)
```


##  모델 정보
모델 이름	mouse_transformer_fixed.onnx
기반 구조	Transformer Encoder (시계열 입력)
입력 형태	(sequence_length, features=4)
특징 벡터	Δx, Δy, 속도, 시간 간격
출력 클래스	[정상, 매크로]
학습 프레임워크	PyTorch
변환 방식	torch.onnx.export() → ONNX Runtime Web
손실 함수	CrossEntropyLoss(weight=[1.0, 5.0]) (클래스 불균형 보정)

##  설치 및 실행
1.  환경 준비
```
node -v     # Node.js 버전 확인
npm -v      # npm 버전 확인
```
2️.  의존성 설치
```
npm install
npm install onnxruntime-web@1.15.1
```
3️.  확장 프로그램 로드
```
Chrome에서 chrome://extensions 접속
개발자 모드 활성화
“압축해제된 확장 프로그램 로드” 클릭
Model/ 폴더 선택
```

## 실행 방식
브라우저에서 마우스 또는 키보드 이벤트 발생 시
realtime_mouse_macro.js 및 realtime_keyboard_macro.js가 이벤트를 3초 단위(window=3000ms)로 수집합니다.
수집된 데이터는 (x / window.innerWidth, y / window.innerHeight) 방식으로 정규화됩니다.
정규화된 시퀀스는 ONNX 모델에 전달되어 추론이 수행됩니다.
모델의 출력 점수가 0.8 이상일 경우,
확장 아이콘에 빨간색 경고 배지(!)가 표시됩니다.
콘솔에 탐지 로그가 출력됩니다.

## 내부 동작 흐름

flowchart TD
    A[사용자 입력 이벤트] --> B[이벤트 수집 (mouse.js, keyboard.js)]
    B --> C[3초 슬라이딩 윈도우 구성]
    C --> D[정규화 및 전처리]
    D --> E[ONNX 모델 추론 (onnxruntime-web)]
    E --> F[탐지 점수 계산]
    F --> G[UI 및 배지 업데이트]

## 코드 예시
```
// realtime_mouse_macro.js (요약)
import * as ort from 'onnxruntime-web';

const windowSize = 3000; // 3초 윈도우
let events = [];

function addEvent(e) {
  const now = performance.now();
  events.push({ x: e.clientX, y: e.clientY, t: now });
  events = events.filter(ev => now - ev.t <= windowSize);
}

async function analyzeEvents() {
  const inputTensor = preprocess(events);
  const session = await ort.InferenceSession.create('models/mouse_transformer_fixed.onnx');
  const results = await session.run({ input: inputTensor });
  const score = results.output.data[1];
  if (score >= 0.8) chrome.action.setBadgeText({ text: '!' });
}
```
## 향후 개선 계획
 키보드 입력 기반 Transformer 모델 추가
 웹사이트별 동적 임계값 조정
 실시간 로그 시각화 및 관리자 리포트 대시보드
 CAPTCHA 입력 구간 자동화 차단 강화 

## 👥 Authors
| 이름 | 역할 |
|-----------|----------|
| **김송혜** | 팀장 · Chrome 확장 구현 |
| **김진섭** | 모델 구현 |
| **송일환** | Chrome 확장 구현 |
| **최서연** | 모델 구현 |

