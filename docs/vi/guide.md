# Hướng dẫn chi tiết `mcp2cli` (Tiếng Việt)

## 1. Tại sao cần chuyển MCP sang CLI + Skill?

Khi gắn nhiều MCP server trực tiếp vào Claude Code, Cursor, VS Code, Codex hay Gemini CLI, toàn bộ JSON schema của mọi tool bị nhồi vào context ở **từng lượt hội thoại**. Với 3–5 MCP server lớn, bạn có thể tốn 30.000–80.000 token chỉ để "mang theo danh sách công cụ".

`mcp2cli` giải quyết triệt để vấn đề này bằng 3 cơ chế:
1. **Progressive Disclosure qua `SKILL.md`:** Ở trạng thái chờ, agent chỉ đọc ~80–100 token phần `name` + `description`. Khi cần mới mở `SKILL.md` hoặc `references/REFERENCE.md`.
2. **Nén dữ liệu đầu ra:** Hỗ trợ `--output toon` (giảm 30–60% token so với JSON), `--fields` (chỉ lấy trường cần thiết), và `--limit` (tránh tràn context).
3. **Script & Code-Mode SDK:** Cho phép chạy độc lập trên Linux, macOS, Windows PowerShell, Alpine Docker và Android Termux mà không cần nhồi lại schema.

## 2. Quy trình chuẩn 4 bước

```bash
# Bước 1: Quét các app agent trên máy
mcp2cli scan

# Bước 2: Đo lượng token đang tốn và xem gợi ý CLI gốc
mcp2cli audit

# Bước 3: Xem trước di chuyển (an toàn, chưa sửa file)
mcp2cli migrate --client cursor --dry-run

# Bước 4: Thực thi di chuyển (tự backup trước khi park MCP cũ)
mcp2cli migrate --client cursor --yes
```

Nếu muốn quay lại cấu hình ban đầu bất kỳ lúc nào:
```bash
mcp2cli restore --client cursor --yes
```

## 3. Bảo mật

- Không bao giờ truyền token/mật khẩu qua cờ dòng lệnh (`argv`). Hãy dùng `env:TEN_BIEN`, `file:/duong/dan`, hoặc lưu vào vault mã hóa AES-256-GCM:
  ```bash
  printf "%s" "$MY_TOKEN" | mcp2cli vault set MY_TOKEN --secret-stdin
  ```
- Các file `.mcp.json` nằm trong repo lạ sẽ không được tự động mở rộng biến `${SECRET}` nếu bạn chưa kiểm tra và thêm cờ `--trust`.
