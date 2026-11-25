# `mcp2cli` — Chuyển đổi MCP trên mọi Agent Client thành CLI, Script & Skill tối ưu chi phí

> **Ngôn ngữ:** [English](README.md) | **Tiếng Việt**

**Ngừng trả "Thuế Token MCP" (MCP Token Tax).**  
Mỗi MCP server gắn trực tiếp vào ứng dụng agent (Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Cline, Roo Code, Codex, Gemini CLI, OpenCode, OpenClaw, Antigravity) đều nhồi hàng chục nghìn token JSON schema vào prompt **ở mọi lượt gọi** — thường tốn 30.000–80.000+ token ngay cả khi bạn chưa dùng tới tool đó.

`mcp2cli` là framework mã nguồn mở TypeScript đa nền tảng giúp bạn:
1. **Quét (`scan`):** Tự động phát hiện toàn bộ MCP server đang cấu hình trong các app agent trên máy / project.
2. **Kiểm toán (`audit`):** Đo chính xác lượng token MCP đang đốt mỗi lượt so với mô hình `SKILL.md` + CLI (thường **giảm 90–99% chi phí token**), đồng thời gợi ý CLI gốc (`gh`, `glab`, `kubectl`, `playwright-cli`...) nếu có sẵn.
3. **Chuyển đổi (`convert`):** Biến bất kỳ MCP server nào (`stdio`, `Streamable HTTP`, `SSE`) thành:
   - **Agent Skill chuẩn `agentskills.io`** (`SKILL.md` + `references/REFERENCE.md` + `clispec.json`)
   - **Script độc lập đa nền tảng** (`scripts/call.sh`, `call.ps1`, `call.py`, `call.mjs`)
   - **Code-Mode Typed SDK** (`sdk/ts/index.ts`, `sdk/py/client.py`)
   - **CLI shim riêng** (`bin/<tên>`, `.cmd`, `.ps1`)
4. **Di chuyển an toàn có hoàn tác (`migrate` & `restore`):** Cài Skill vào đúng thư mục của app agent, sao lưu `.mcp2cli.backup` và tạm đóng/cất (park) cấu hình MCP gốc — hoàn tác 100% chỉ bằng 1 lệnh `restore`.
5. **Chạy trực tiếp (`run` & `session`):** Hỗ trợ session nền giữ kết nối ấm (Unix Socket trên Linux/macOS/Termux, Named Pipe trên Windows), xuất `--output toon|json|ndjson|yaml|text`, lọc `--fields`, giới hạn `--limit`, và kiểm tra trước `--dry-run`.

---

## Cài đặt

Yêu cầu **Node.js ≥ 22.0.0** (chạy trên Linux `glibc`/`musl`, macOS, Windows PowerShell/`cmd.exe`, BSD, Android Termux, Docker, CI — **không phụ thuộc native C++ addon**).

### Cách 1: Dùng ngay trong AI Agent Client (Khuyên dùng — không cần tự mở Terminal)

Nếu bạn đang dùng **Claude Code, Cursor, Antigravity, Windsurf, Cline, Roo Code, Codex, Gemini CLI hoặc OpenCode**, chỉ cần copy-paste câu này cho agent của bạn:

> *"Cài đặt và thiết lập https://github.com/ntrieuvi97/mcp2cli (kèm skill `skills/mcp2cli/SKILL.md`), quét các MCP server hiện có, đo lượng token đang tốn mỗi lượt, rồi cho tôi xem trước phương án migrate an toàn trước khi áp dụng."*

Hoặc cài sẵn Agent Skill `mcp2cli` bằng 1 lệnh (agent sẽ tự động cài/chạy CLI khi cần):

```bash
npx skills add ntrieuvi97/mcp2cli
```

### Cách 2: Cài CLI qua Terminal

```bash
# Cài trực tiếp từ GitHub
npm install -g github:ntrieuvi97/mcp2cli

# Hoặc chạy thử không cần cài global
npx --yes github:ntrieuvi97/mcp2cli --help
```

<details>
<summary>Cài từ npm registry (khi đã publish) hoặc từ mã nguồn</summary>

```bash
# Từ npm registry
npm install -g @ntrieuvi97/mcp2cli

# Từ mã nguồn (dành cho contributor)
git clone https://github.com/ntrieuvi97/mcp2cli.git
cd mcp2cli
pnpm install
pnpm run build
pnpm link --global
```

</details>

## Sử dụng nhanh

```bash
# 1. Quét toàn bộ MCP trên các app agent
mcp2cli scan

# 2. Kiểm toán lượng token tiết kiệm được
mcp2cli audit

# 3. Chuyển đổi thành Skill + Script + SDK
mcp2cli convert --out ./skills

# 4. Di chuyển an toàn cho Cursor (xem trước bằng --dry-run)
mcp2cli migrate --client cursor --dry-run
mcp2cli migrate --client cursor --yes

# Hoàn tác nếu cần
mcp2cli restore --client cursor --yes

# 5. Chạy tool với định dạng TOON siêu tiết kiệm token
mcp2cli run my-server --list --compact
mcp2cli run my-server search-issues --query "bug" --fields id,title --limit 10 --output toon
```

Xem chi tiết kiến trúc tại [docs/vi/guide.md](docs/vi/guide.md) hoặc bản tiếng Anh tại [README.md](README.md).
