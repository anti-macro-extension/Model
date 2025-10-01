import os
import pandas as pd
import json

# 경로
base_dir = r"C:\Users\wnsro\Documents\ai_project\Model\raw_data"
save_dir = r"C:\Users\wnsro\Documents\ai_project\Model\data"
os.makedirs(save_dir, exist_ok=True)

# type 매핑
type_map = {
    "move": "m",
    "up": "c",
    "wheel": "s"
}

def convert_folder_to_json(folder_path, label, prefix):
    data = []
    for i, file in enumerate(os.listdir(folder_path)):
        if file.endswith(".csv"):
            csv_path = os.path.join(folder_path, file)
            df = pd.read_csv(csv_path)

            # session_id
            session_id = f"{prefix}_{i+1:04d}"

            # total_behaviour → [m(x,y)] 형식 (type에 따라 m/c/s)
            total_behaviour = "".join([
                f"[{type_map.get(row['type'], 'm')}({row['x']},{row['y']})]"
                for _, row in df.iterrows()
            ])

            # mousemove_times → timestamp만 쉼표로
            mousemove_times = ",".join([str(int(row['timestamp'])) for _, row in df.iterrows()])

            # mousemove_total_behaviour → [x,y] 형식
            mousemove_total_behaviour = "".join([f"[{row['x']},{row['y']}]" for _, row in df.iterrows()])

            # JSON 세션 구조
            session = {
                "session_id": session_id,
                "label": label,
                "total_behaviour": total_behaviour,
                "mousemove_times": mousemove_times,
                "mousemove_total_behaviour": mousemove_total_behaviour
            }
            data.append(session)
    return data

# human(0), macro(1) 변환
human_data = convert_folder_to_json(os.path.join(base_dir, "human"), label=0, prefix="human")
macro_data = convert_folder_to_json(os.path.join(base_dir, "macro"), label=1, prefix="macro")

# 합치기
all_data = human_data + macro_data

# JSON 저장
with open(os.path.join(save_dir, "dataset.json"), "w", encoding="utf-8") as f:
    json.dump(all_data, f, ensure_ascii=False, indent=2)

print(f"변환 완료! 저장 경로: {os.path.join(save_dir, 'dataset.json')}")
