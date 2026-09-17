# AGENTS.md

面向所有编码智能体（Claude Code / Codex / Cursor 等）。项目背景与模块细节见
[README.md](README.md) 与 [docs/wiki/](docs/wiki/README.md)；这里只记**不看代码就会踩坑**
的部分。

## 动手之前先切 Node 版本

项目要求 Node 24，由 `.nvmrc` 声明 —— 所以第一条命令永远是：

```bash
nvm use          # 读 .nvmrc → 24；等价于 nvm use 24
```

开发机上同时装了 Node 14，而 nvm 没有设 `default` alias，新开终端会默认落在
**Node 14** 上，`pnpm` / `vite` 直接报错。

| 依赖 | 要求 | 真值来源 |
| --- | --- | --- |
| Node | **24**（最低 20） | `.nvmrc`、`package.json` 的 `engines` |
| pnpm | **10**（当前 10.34.5） | `package.json` 的 `packageManager`、`engines` |
| Rust | **1.87+** | `src-tauri/Cargo.toml` 的 `rust-version` |

绑版本不是形式主义，三个都是实际会拦下你的：

- Node 14 下 `pnpm check:locales` 报 `requires at least Node.js v18.12`。
- pnpm 9 会被 `engines.pnpm` 挡下（`ERR_PNPM_UNSUPPORTED_ENGINE`）。
  升级：`npm i -g pnpm@10` 或 `corepack enable`。
- Rust 低于 1.87 编译不过 —— Tauri 2 的依赖树需要 edition2024。

## 常用命令

```bash
pnpm install            # 装依赖（.npmrc 已钉公共 registry，见下）
pnpm dev                # 只调 UI：浏览器 + 内置 mock，不起 Tauri 外壳
pnpm tauri:dev          # 完整桌面应用（首次要编译 Rust，数分钟）
pnpm build              # tsc --noEmit && vite build
pnpm check:locales      # 中英词典的键与插值对齐
pnpm test:messages      # 后端错误码 → 界面文案的翻译链路
```

Rust 侧（`cd src-tauri`）：

```bash
cargo test
cargo clippy --all-targets -- -D warnings    # CI 门禁，当前基线 0 警告
```

提交前至少跑一遍这五条：`check:locales` / `test:messages` / `build` /
`cargo test` / `cargo clippy`。CI 跑的就是这些。

## 四个容易踩的坑

**1. 不要改 `.npmrc` 的 registry 而不重新生成 lockfile。**
仓库钉的是公共 npm（`registry.npmjs.org`，pnpm 的默认值）。pnpm 只在「生效
registry ≠ 默认值」时才把完整 tarball 地址写进 lockfile —— 一旦跟随私服生成，
1185 个包的地址会被固化，CI 访问不到就 `ERR_SOCKET_TIMEOUT`（这就是历史上 CI
不明原因失败的根因）。改 registry 必须同时重生成 lockfile。

**2. 不要跑 `cargo fmt`。**
全库从未 rustfmt 过，一次格式化会产生横跨 13 个文件、48 个 hunk 的纯噪音 diff。
格式化是个独立决定，不在当前约定内；`cargo clippy` 才是 CI 的那道门。

**3. `scripts/` 不在 `tsconfig.json` 的 `include` 里。**
所以 `scripts/check-messages.test.ts` 不受 `tsc --noEmit` 覆盖 —— 改它之后要
手动 `pnpm test:messages` 验证。

**4. 版本号有四处硬编码，没有单一真值。**
`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`，外加
`src/locales/*.json` 里给侧边栏显示的 `app.version` 字符串。改版本要同步四处。

## 设计不变量（改代码前先读这段）

**安全边界在 Rust，前端只传 id。** 所有可安装/可执行的真值 —— npm 包名、git
仓库 URL、MCP 的 command+args、供应商端点 —— 都写死在常量表里
（`registry.rs` / `skills.rs` / `mcp.rs` / `providers.rs`）。前端拼不出命令，
所以命令注入结构性不成立。**不要为了让前端方便而让它参与拼字符串**。

**后端错误是「码」，不是给人看的文案。** Rust 返回 `{"code":..,"args":..}` 的 JSON
串（`src-tauri/src/error.rs`），翻译在前端 `src/lib/errors.ts`。新增错误码要同时
在 `zh-CN.json` 与 `en-US.json` 的 `errors.*` / `notes.*` 各加一条，否则用户会看到
裸露的键名。反过来，**不要在 Rust 里写面向用户的中文/英文句子**。

**写用户的配置文件必须可逆。** 宿主文件（`~/.claude.json`、`~/.codex/config.toml`、
`~/.gemini/.env` 等）里有大量用户手写内容，约定是：managed 清单记录自己写过什么、
写前备份 `.cchub.bak`、原子写（tmp + rename 且检查 rename 的错误）。
**只删自己写的键/段，用户手写内容永不触碰。**

**前后端类型契约是手写的。** `src/types/index.ts` 手动镜像 Rust 结构体，没有代码
生成也没有对照测试 —— 改 Rust 结构体必须手动同步这里，否则漂移静默发生。
