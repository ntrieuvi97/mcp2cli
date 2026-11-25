# Contributing to `mcp2cli`

Thank you for contributing to `mcp2cli`!

## Development Setup

```bash
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
```

## Guidelines

- **English First:** Code, commit messages, PR descriptions, tests, and primary docs must be in English. Translations (such as Vietnamese in `docs/vi/`) are warmly welcomed.
- **Cross-Platform Always:** Avoid bashisms, POSIX-only path assumptions, or native C++ Node addons. Test path handling with `node:path` and consider Windows PowerShell/Named Pipes, Linux `musl`, macOS, and Android Termux.
- **clispec v0.2:** Any new CLI command or flag must be documented in `src/commands/schema.ts` (`MCP2CLI_CLISPEC_V02`).
- **Tests Required:** Add unit or E2E tests in `tests/` for every new client driver, emitter, or CLI behavior.
