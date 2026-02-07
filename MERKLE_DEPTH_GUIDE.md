# Hướng dẫn sử dụng Merkle Tree với độ sâu khác nhau

## Tổng quan

Dự án này hỗ trợ tạo và sử dụng Merkle tree với các độ sâu khác nhau (5, 10, 15) để xác minh diploma. Mỗi độ sâu có những đặc điểm riêng:

- **Độ sâu 5**: 32 leaves (2^5), phù hợp cho test nhỏ
- **Độ sâu 10**: 1,024 leaves (2^10), phù hợp cho ứng dụng vừa
- **Độ sâu 15**: 32,768 leaves (2^15), phù hợp cho ứng dụng lớn

## Cấu trúc file

### Dữ liệu Merkle Tree
- `merkle_tree_data_depth_5.json` - Dữ liệu Merkle tree độ sâu 5
- `merkle_tree_data_depth_10.json` - Dữ liệu Merkle tree độ sâu 10  
- `merkle_tree_data_depth_15.json` - Dữ liệu Merkle tree độ sâu 15

### Circuits
- `circuits/DiplomaVerifier.circom` - Circuit gốc (độ sâu 5)
- `circuits/DiplomaVerifier_Depth10.circom` - Circuit độ sâu 10
- `circuits/DiplomaVerifier_Depth15.circom` - Circuit độ sâu 15

### Input files
- `input_depth_10_index_0.json` - Input cho circuit độ sâu 10, diploma index 0
- `input_depth_15_index_0.json` - Input cho circuit độ sâu 15, diploma index 0

## Scripts chính

### 1. MerkleDepthManager (Script tổng hợp)
```bash
# Hiển thị hướng dẫn
node scripts/merkle_depth_manager.js

# Hiển thị thông tin các Merkle tree và circuits
node scripts/merkle_depth_manager.js info

# Tạo Merkle tree với độ sâu cụ thể
node scripts/merkle_depth_manager.js create 10

# Compile circuit với độ sâu cụ thể
node scripts/merkle_depth_manager.js compile 10

# Tạo input cho circuit
node scripts/merkle_depth_manager.js input 10 0

# Tạo tất cả (Merkle trees + circuits + inputs)
node scripts/merkle_depth_manager.js all
```

### 2. Scripts riêng lẻ

#### Tạo Merkle tree với độ sâu tùy chỉnh
```bash
node scripts/create_merkle_tree_depth.js
```

#### Tạo input cho circuit
```bash
node scripts/generate_input_depth.js 10 0  # Độ sâu 10, index 0
node scripts/generate_input_depth.js 15 5  # Độ sâu 15, index 5
```

#### Compile circuits
```bash
node scripts/compile_depth_circuits.js
```

## Quy trình sử dụng

### Bước 1: Tạo dữ liệu Merkle tree
```bash
# Tạo tất cả Merkle trees
node scripts/merkle_depth_manager.js all

# Hoặc tạo từng cái một
node scripts/merkle_depth_manager.js create 10
node scripts/merkle_depth_manager.js create 15
```

### Bước 2: Compile circuits
```bash
# Compile tất cả circuits
node scripts/merkle_depth_manager.js compile 10
node scripts/merkle_depth_manager.js compile 15
```

### Bước 3: Tạo input cho testing
```bash
# Tạo input cho diploma index 0
node scripts/merkle_depth_manager.js input 10 0
node scripts/merkle_depth_manager.js input 15 0
```

### Bước 4: Kiểm tra thông tin
```bash
node scripts/merkle_depth_manager.js info
```

## So sánh các độ sâu

| Độ sâu | Số leaves | Kích thước file | Thời gian compile | Thời gian proving |
|--------|-----------|-----------------|-------------------|-------------------|
| 5      | 32        | ~15KB           | Nhanh             | Rất nhanh         |
| 10     | 1,024     | ~24KB           | Trung bình        | Nhanh             |
| 15     | 32,768    | ~34KB           | Chậm              | Trung bình        |

## Lưu ý quan trọng

1. **Dữ liệu diploma**: Tất cả Merkle trees đều sử dụng cùng dữ liệu diploma từ `processed_diplomas.json` (20 diplomas thật)

2. **Zero padding**: Các Merkle tree được padding với giá trị "0" để đạt đúng số lượng leaves cần thiết

3. **Root khác nhau**: Mỗi độ sâu sẽ có root khác nhau do cấu trúc tree khác nhau

4. **Proof length**: Độ dài proof bằng với độ sâu của tree (5, 10, hoặc 15 elements)

## Troubleshooting

### Lỗi "File không tồn tại"
```bash
# Đảm bảo đã tạo Merkle tree trước
node scripts/merkle_depth_manager.js create 10
```

### Lỗi compile circuit
```bash
# Kiểm tra circom đã được cài đặt
circom --version

# Compile từng circuit riêng lẻ
node scripts/merkle_depth_manager.js compile 10
```

### Lỗi index không hợp lệ
```bash
# Kiểm tra số lượng diplomas có sẵn
cat processed_diplomas.json | jq '. | length'

# Sử dụng index từ 0 đến (số diplomas - 1)
node scripts/merkle_depth_manager.js input 10 0
```

## Ví dụ sử dụng

### Tạo và test Merkle tree độ sâu 10
```bash
# 1. Tạo Merkle tree
node scripts/merkle_depth_manager.js create 10

# 2. Compile circuit
node scripts/merkle_depth_manager.js compile 10

# 3. Tạo input
node scripts/merkle_depth_manager.js input 10 0

# 4. Kiểm tra thông tin
node scripts/merkle_depth_manager.js info
```

### So sánh performance giữa các độ sâu
```bash
# Tạo tất cả
node scripts/merkle_depth_manager.js all

# Kiểm tra thông tin
node scripts/merkle_depth_manager.js info
```

## Kết luận

Hệ thống này cho phép bạn dễ dàng tạo và sử dụng Merkle tree với các độ sâu khác nhau, phù hợp với các nhu cầu ứng dụng khác nhau. Script `merkle_depth_manager.js` cung cấp interface thống nhất để quản lý tất cả các operations.