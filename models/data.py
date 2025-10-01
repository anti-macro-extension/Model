import onnx

# 모델 로드
model = onnx.load("mouse_transformer_fixed.onnx")

# int64 타입 체크
print("=== [1] 입력/출력 타입 점검 ===")
for t in list(model.graph.input) + list(model.graph.output):
    elem_type = t.type.tensor_type.elem_type
    if elem_type == 7:
        print(f"⚠️ int64 발견 (입출력): {t.name}")
    else:
        print(f"✅ {t.name} -> elem_type={elem_type}")

print("\n=== [2] Initializer 타입 점검 ===")
for init in model.graph.initializer:
    if init.data_type == 7:
        print(f"⚠️ int64 발견 (initializer): {init.name}")
    else:
        pass

print("\n=== [3] Node Attribute 점검 ===")
for node in model.graph.node:
    for attr in node.attribute:
        if attr.type == onnx.AttributeProto.INTS:
            if any(isinstance(v, int) and v > 2**31-1 or v < -2**31 for v in attr.ints):
                print(f"⚠️ int64 가능성 있음 (node={node.op_type}, attr={attr.name}, values={list(attr.ints)})")

print("검사 완료 ✅")

