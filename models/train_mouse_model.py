import os
import json
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, random_split
import numpy as np
import onnx

# ======================
# 1. 데이터셋 정의 (정규화 적용)
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

        events = []
        for ev in sample["total_behaviour"].split("]"):
            if ev.strip() == "":
                continue
            ev = ev.strip("[]")
            etype, coords = ev[0], ev[2:-1].split(",")
            x, y = map(int, coords)
            ecode = event_map.get(etype, 0)

            # === 좌표 정규화 (0~1 범위)
            norm_x = x / self.screen_width
            norm_y = y / self.screen_height

            events.append([ecode, norm_x, norm_y])

        events = np.array(events, dtype=np.float32)

        # padding
        if len(events) < self.max_len:
            pad = np.zeros((self.max_len - len(events), 3), dtype=np.float32)
            events = np.vstack([events, pad])
        else:
            events = events[:self.max_len]

        return torch.tensor(events, dtype=torch.float32), torch.tensor(label, dtype=torch.long)

# ======================
# 2. Transformer 모델
# ======================
class MouseTransformer(nn.Module):
    def __init__(self, input_dim=3, d_model=64, nhead=4, num_layers=2, num_classes=2, max_len=200):
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
# 3. 학습 + 검증
# ======================
def train_model(json_path, epochs=50, batch_size=32, max_len=200, val_ratio=0.2):
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    dataset = MouseDataset(data, max_len=max_len)

    # Train/Validation Split
    val_size = int(len(dataset) * val_ratio)
    train_size = len(dataset) - val_size
    train_set, val_set = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_set, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=batch_size, shuffle=False)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = MouseTransformer(max_len=max_len).to(device)

    # 수정 (클래스 불균형 보정)
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

        print(f"Epoch {epoch+1}/{epochs}, Train Acc: {train_acc:.4f}, Val Acc: {val_acc:.4f}, Loss: {total_loss:.4f}")

    return model


# ======================
# 4. 실행 & ONNX 변환
# ======================
if __name__ == "__main__":
    json_path = r"C:\Users\wnsro\Documents\ai_project\Model\data\dataset.json"
    trained_model = train_model(json_path, epochs=50, batch_size=32, max_len=200)

    # PyTorch 저장
    torch.save(trained_model.state_dict(), "mouse_transformer.pth")
    print("모델 저장 완료: mouse_transformer.pth")

    # === ONNX 변환 ===
    dummy = torch.randn(1, 200, 3, dtype=torch.float32)  # float 입력 유지
    onnx_path = "mouse_transformer.onnx"

    torch.onnx.export(
        trained_model,        # <-- 여기!
        dummy,
        onnx_path,
        input_names=["input"],
        output_names=["output"],
        opset_version=17,
        dynamic_axes={"input": {0: "batch_size"}, "output": {0: "batch_size"}},
    )

    print("ONNX 모델 저장 완료:", onnx_path)

    # === int64 → int32 강제 변환 ===
    model = onnx.load(onnx_path)
    for t in list(model.graph.input) + list(model.graph.output):
        if t.type.tensor_type.elem_type == 7:  # int64
            t.type.tensor_type.elem_type = 6   # int32
    for init in model.graph.initializer:
        if init.data_type == 7:
            init.data_type = 6

    fixed_path = "mouse_transformer_fixed.onnx"
    onnx.save(model, fixed_path)
    print("수정된 ONNX 모델 저장 완료:", fixed_path)
