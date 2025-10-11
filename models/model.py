import os
import json
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, random_split
import numpy as np
import onnx

# ======================
# 1. 데이터셋 정의 (정규화 + 속도 + 가속도)
# ======================
event_map = {"m": 0, "c": 1, "s": 2}  # move, click, scroll

class MouseDataset(Dataset):
    def __init__(self, json_data, max_len=200, screen_width=1920, screen_height=1080):
        self.samples = json_data
        self.max_len = max_len
        self.screen_width = screen_width
        self.screen_height = screen_height

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]
        label = sample["label"]

        events, coords, times = [], [], []

        # --- total_behaviour 파싱
        for ev in sample["total_behaviour"].split("]"):
            if ev.strip() == "":
                continue
            ev = ev.strip("[]")
            etype, coords_str = ev[0], ev[2:-1].split(",")
            x, y = map(int, coords_str)
            ecode = event_map.get(etype, 0)
            coords.append((x, y))
            events.append(ecode)

        # --- 시간 파싱 (없으면 순차적 증가로 대체)
        if "mousemove_times" in sample:
            try:
                times = [int(t) for t in sample["mousemove_times"].split(",")]
            except:
                times = list(range(len(coords)))
        else:
            times = list(range(len(coords)))

        # --- 정규화 + 속도/가속도 계산
        features = []
        prev_speed = 0.0

        for i in range(len(coords)):
            x, y = coords[i]
            norm_x = x / self.screen_width
            norm_y = y / self.screen_height

            if i == 0:
                speed = 0.0
                accel = 0.0
            else:
                dx = (coords[i][0] - coords[i-1][0]) / self.screen_width
                dy = (coords[i][1] - coords[i-1][1]) / self.screen_height
                dt = max(1, times[i] - times[i-1])  # 시간 간격(ms)
                speed = (dx**2 + dy**2) ** 0.5 / dt
                accel = (speed - prev_speed) / dt
                prev_speed = speed

            features.append([events[i], norm_x, norm_y, speed, accel])

        features = np.array(features, dtype=np.float32)

        # --- Padding
        if len(features) < self.max_len:
            pad = np.zeros((self.max_len - len(features), 5), dtype=np.float32)
            features = np.vstack([features, pad])
        else:
            features = features[:self.max_len]

        return torch.tensor(features, dtype=torch.float32), torch.tensor(label, dtype=torch.long)


# ======================
# 2. Transformer 모델 정의
# ======================
class MouseTransformer(nn.Module):
    def __init__(self, input_dim=5, d_model=64, nhead=4, num_layers=2, num_classes=2, max_len=200):
        super(MouseTransformer, self).__init__()
        self.input_fc = nn.Linear(input_dim, d_model)
        self.pos_embedding = nn.Parameter(torch.randn(1, max_len, d_model))
        encoder_layer = nn.TransformerEncoderLayer(d_model=d_model, nhead=nhead, batch_first=True)
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.fc = nn.Linear(d_model, num_classes)

    def forward(self, x):
        x = self.input_fc(x)
        x = x + self.pos_embedding[:, :x.size(1), :]
        out = self.transformer(x)
        out = out.mean(dim=1)  # 시퀀스 평균 풀링
        return self.fc(out)


# ======================
# 3. 학습 함수
# ======================
def train_model(json_path, epochs=50, batch_size=32, max_len=200, val_ratio=0.2):
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    dataset = MouseDataset(data, max_len=max_len)

    val_size = int(len(dataset) * val_ratio)
    train_size = len(dataset) - val_size
    train_set, val_set = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_set, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=batch_size, shuffle=False)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = MouseTransformer(max_len=max_len).to(device)

    # 클래스 불균형 보정
    criterion = nn.CrossEntropyLoss(weight=torch.tensor([1.0, 5.0]).to(device))
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)

    for epoch in range(epochs):
        # === Train ===
        model.train()
        total_loss, correct, total = 0, 0, 0
        for X, y in train_loader:
            X, y = X.to(device), y.to(device)
            optimizer.zero_grad()
            outputs = model(X)
            loss = criterion(outputs, y)
            loss.backward()
            optimizer.step()

            total_loss += loss.item()
            _, predicted = outputs.max(1)
            correct += (predicted == y).sum().item()
            total += y.size(0)

        train_acc = correct / total

        # === Validation ===
        model.eval()
        val_correct, val_total = 0, 0
        with torch.no_grad():
            for X, y in val_loader:
                X, y = X.to(device), y.to(device)
                outputs = model(X)
                _, predicted = outputs.max(1)
                val_correct += (predicted == y).sum().item()
                val_total += y.size(0)
        val_acc = val_correct / val_total

        print(f"Epoch {epoch+1}/{epochs} | Train Acc: {train_acc:.4f} | Val Acc: {val_acc:.4f} | Loss: {total_loss:.4f}")

    return model


# ======================
# 4. 학습 및 ONNX 변환
# ======================
if __name__ == "__main__":
    json_path = r"C:\Users\wnsro\Documents\ai_project\Model\data\dataset.json"
    trained_model = train_model(json_path, epochs=50, batch_size=32, max_len=200)

    torch.save(trained_model.state_dict(), "mouse_transformer_speed.pth")
    print("✅ 모델 저장 완료: mouse_transformer_speed.pth")

    dummy = torch.randn(1, 200, 5, dtype=torch.float32)
    onnx_path = "mouse_transformer_speed.onnx"

    torch.onnx.export(
        trained_model,
        dummy,
        onnx_path,
        input_names=["input"],
        output_names=["output"],
        opset_version=17,
        dynamic_axes={"input": {0: "batch_size"}, "output": {0: "batch_size"}},
    )
    print("✅ ONNX 모델 저장 완료:", onnx_path)

    # === int64 → int32 변환 ===
    model = onnx.load(onnx_path)
    for t in list(model.graph.input) + list(model.graph.output):
        if t.type.tensor_type.elem_type == 7:
            t.type.tensor_type.elem_type = 6
    for init in model.graph.initializer:
        if init.data_type == 7:
            init.data_type = 6

    fixed_path = "mouse_transformer_speed_fixed.onnx"
    onnx.save(model, fixed_path)
    print("✅ 수정된 ONNX 모델 저장 완료:", fixed_path)
