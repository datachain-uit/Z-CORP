# Sơ đồ luồng tạo Proof chứng minh văn bằng

## ASCII (đơn giản, xem mọi nơi)

```
  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
  │  1. INPUT       │     │  2. WITNESS     │     │  3. PROOF      │
  │                 │     │                 │     │                 │
  │  generate_      │ ──► │  generate_      │ ──► │  snarkjs       │
  │  input_depth.js │     │  witness.js     │     │  groth16 prove  │
  │                 │     │  + WASM         │     │                 │
  │  → input.json   │     │  → witness.wtns  │     │  → proof.json   │
  │                 │     │                 │     │  → public.json  │
  └─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                           │
                                                           ▼
                                                  ┌─────────────────┐
                                                  │  4. VERIFY     │
                                                  │  snarkjs       │
                                                  │  groth16 verify│
                                                  └─────────────────┘
```

---

## Luồng tổng quan (Mermaid)

```mermaid
flowchart LR
    subgraph Chuẩn bị
        A[Diploma + Merkle Tree] --> B[input.json]
    end

    subgraph Tạo Proof
        B --> C[Witness]
        C --> D[Proof + Public]
    end

    subgraph Kiểm tra
        D --> E[Verify]
    end

    A -.->|prepare_diploma_data<br/>create_merkle_tree_depth| A
    B -.->|generate_input_depth.js| B
    C -.->|generate_witness.js + WASM| C
    D -.->|snarkjs groth16 prove| D
    E -.->|snarkjs groth16 verify| E
```

## Chi tiết từng bước

```mermaid
flowchart TD
    Start([Bắt đầu]) --> I1[1. Input]
    I1 --> I1a["generate_input_depth.js depth index"]
    I1a --> I1b["input_depth_X_index_Y.json<br/>(diploma + root + pathIndices + siblings)"]

    I1b --> W1[2. Witness]
    W1 --> W1a["generate_witness.js<br/>WASM + input → witness.wtns"]

    W1a --> P1[3. Prove]
    P1 --> P1a["snarkjs groth16 prove<br/>zkey + witness → proof.json + public.json"]

    P1a --> V1[4. Verify]
    V1 --> V1a["snarkjs groth16 verify<br/>vkey + public + proof"]

    V1a --> End([Proof hợp lệ])
```

## Dạng đơn giản (3 bước chính)

```mermaid
flowchart LR
    A[📄 Input<br/>input.json] --> B[⚙️ Witness<br/>witness.wtns]
    B --> C[🔐 Proof<br/>proof.json + public.json]

    style A fill:#e1f5fe
    style B fill:#fff3e0
    style C fill:#e8f5e9
```

## Công cụ tương ứng

| Bước   | Input        | Công cụ                    | Output              |
|--------|--------------|----------------------------|---------------------|
| 1      | depth, index | `generate_input_depth.js`  | `input_*.json`      |
| 2      | input + WASM | `generate_witness.js`     | `witness.wtns`      |
| 3      | zkey + witness | `snarkjs groth16 prove`  | `proof.json`, `public.json` |
| 4 (verify) | vkey + public + proof | `snarkjs groth16 verify` | OK / Fail |
