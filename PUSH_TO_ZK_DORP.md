# Push code lên repo ZK-DORP

Repo đích: **https://github.com/datachain-uit/ZK-DORP**

Chạy các lệnh sau **từ thư mục gốc project** (`testcircom`).

---

## 1. Thêm remote cho repo mới

```bash
git remote add zkdorp https://github.com/datachain-uit/ZK-DORP.git
```

(Kiểm tra: `git remote -v` — sẽ thấy `origin` và `zkdorp`.)

---

## 2. Stage toàn bộ thay đổi

```bash
git add -A
```

Nếu **không** muốn đẩy file nặng (`.ptau`, `.zkey`, `.wtns`): mở `.gitignore`, bỏ comment các dòng `*.ptau`, `*.zkey`, `*.wtns`, rồi chạy lại `git add -A`.

---

## 3. Commit

```bash
git commit -m "feat: multi-depth circuits (5-15), Groth16 & Plonk experiments, README and scripts"
```

(Có thể đổi message tùy ý.)

---

## 4. Push lên ZK-DORP

**Lần đầu push (tạo nhánh `master` trên remote):**

```bash
git push -u zkdorp master
```

Nếu repo **ZK-DORP** dùng nhánh mặc định là `main`:

```bash
git push -u zkdorp master:main
```

**Các lần sau:**

```bash
git push zkdorp master
# hoặc nếu đã dùng main:
git push zkdorp master:main
```

---

## 5. Nếu repo ZK-DORP đã có sẵn nội dung

Nếu `datachain-uit/ZK-DORP` đã có commit (ví dụ README tạo từ GitHub), bạn có hai lựa chọn:

**A. Pull rồi merge rồi push (giữ lịch sử hai bên):**

```bash
git fetch zkdorp
git checkout master
git merge zkdorp/main --allow-unrelated-histories
# Giải quyết conflict nếu có, rồi:
git push -u zkdorp master:main
```

**B. Force push (ghi đè hoàn toàn nội dung ZK-DORP bằng code local):**

```bash
git push -u zkdorp master:main --force
```

Chỉ dùng B khi bạn chắc muốn thay thế toàn bộ nội dung repo đích.

---

## Tóm tắt nhanh (repo trống, push lần đầu)

```bash
cd /Users/votankhoa/Desktop/testcircom
git remote add zkdorp https://github.com/datachain-uit/ZK-DORP.git
git add -A
git status
git commit -m "feat: multi-depth circuits, Groth16 & Plonk, README and scripts"
git push -u zkdorp master:main
```

(Nếu GitHub báo nhánh mặc định là `master`, đổi `main` thành `master` trong lệnh push.)
