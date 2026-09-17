# 前端架构

技术栈：React 19 + TypeScript 7 + Vite 8 + Tailwind CSS 4 + shadcn/ui + Zustand 5
+ React Router 7（HashRouter）+ i18next。UI 原语库是 **Base UI**
（`@base-ui/react`，对应 shadcn 的 `base-vega` 风格），项目内已无 Radix。

## 目录职责

| 目录/文件 | 职责 |
| --- | --- |
| `main.tsx` | 挂载前同步定型主题与语言，`HashRouter` 渲染 |
| `App.tsx` | `Sidebar` + 6 条路由 + 全局 `useLocale()` |
| `types/index.ts` | **前后端契约**：镜像 Rust 结构体，每个接口注明对齐的 `.rs` 文件 |
| `lib/ipc.ts` | **唯一 IPC 通道** + 浏览器 mock |
| `lib/errors.ts` | 结构化错误码 → 词典翻译 |
| `i18n/` | 语言初始化、落地、校正 |
| `store/` | 6 个领域 store |
| `pages/` | 6 个页面 |
| `components/` | `ui/`（shadcn 原语，Base UI 实现）、`layout/`、业务组件 |

## 路由表

```tsx
/          → AppStore      // 应用商店
/skills    → Skills        // Skill 管理
/mcp       → Mcp           // MCP 配置
/keys      → ApiKeys       // API Key
/routes    → Routes        // 请求路由
/settings  → Settings      // 设置
*          → Navigate to /
```

用 `HashRouter` 而非 `BrowserRouter`：Tauri 用 `tauri://` 协议提供前端，
没有 history 服务端，hash 路由最稳。

## IPC 层（`lib/ipc.ts`）

单一分发器，每个导出函数都是 `if (!isTauri()) return mock...` 的形状：

| 能力 | Tauri 路径 | 浏览器路径 |
| --- | --- | --- |
| 调用命令 | `invoke`（动态 import） | 返回 mock |
| 监听事件 | `listen`（动态 import） | `mockListeners` 的 Set |
| 持久化 | Rust 写盘 | localStorage 键（`MOCK_*`） |
| 打开外链 | `plugin-opener` 的 `openUrl` | `window.open` |
| 开机自启 | `plugin-autostart` | mock |

动态 `import()` 是关键 —— 浏览器模式下不会把 Tauri 的 JS 包引进来。

### mock 的设计原则

mock 不是「随便返回点数据」，而是**刻意覆盖真实会走的边界分支**：

- `claude-code` mock 成 Homebrew 安装的 non-managed 状态 → 走「隐藏 npm 操作」
  分支；`workbuddy` mock 成 `officialApp` + `installUrl` → 走「打开官网」分支。
- `mockRunTask` 用 `setTimeout` 逐行推 `TaskLog`，最后推 `TaskFinished`，
  完整复现流式日志体验。
- mock 抛错也用 `wireError(code, args)` 构造与 Rust 同格式的 JSON 串。

因此 `pnpm dev`（无 Tauri 外壳）可以覆盖绝大部分 UI 分支，是主要的 UI 调试方式。

## Zustand store

| store | 职责 | 关键 action |
| --- | --- | --- |
| `apps.ts` | 环境 / 应用状态 / 版本 / 任务日志 | `bootstrap(behavior)`、`refreshStatuses`、`checkUpdates`、`runTask`、`clearTask` |
| `catalog.ts` | 目录 + 偏好 | `loadCatalog`、`setPrefs`（乐观更新 + 失败回滚） |
| `keys.ts` | Key 索引 / 测试结果 / 明文显示 | `add`、`remove`、`test`、`reveal`、`mask` |
| `mcp.ts` | 服务目录 + 各宿主当前配置 | `load`、`add`、`remove`、`test`（ops 按 `hostId/serviceId` 记状态） |
| `routes.ts` | 预设 / 激活态 / 宿主回读 / 供应商 | `save`、`remove`、`switchTo`、`clear`、`apply` |
| `skills.ts` | 已安装 + 可安装源 | `setEnabled`（乐观更新失败回滚）、`install`、`uninstall` |

几个值得注意的点：

- **`bootstrap` 用 `listening` 标志只挂一次事件监听**，且等 `prefs` 到位后再跑
  （`prefs === null` 时不先跑）。`detectOnLaunch` / `checkUpdatesOnLaunch`
  两个偏好门控首屏行为，**手动刷新按钮不受门控影响**。
- **结果文案在消息产生那一刻定型**（用当时的语言调 `describeNote`）。之后切语言
  不会回溯改写历史日志 —— 这是明示的取舍。
- 日志 `MAX_LOG_LINES = 400`，超出截尾。
- `setPrefs` 是**乐观更新 + 失败回滚 + 回滚主题**的组合；目录源或代理变化会
  触发重新 `loadCatalog`。

## 主题三段式（`lib/theme.ts`）

偏好是异步 IPC 读来的，但首屏必须立刻是对的颜色，否则会闪一下错误配色。
解法是「缓存定型 → 真值校正 → 唯一出口」：

1. `initTheme()`（同步，挂载前）：读 localStorage 缓存（prefs 的镜像）设 class。
2. prefs 加载完成后 `syncTheme` 校正，以 prefs 真值为准。
3. `applyTheme(theme)` 是**唯一出口**：切 `.dark`/`.light` class 与 `color-scheme`。

`globals.css` 里 `@custom-variant dark (&:where(.dark, .dark *))` 定义暗色变体，
并用 `prefers-color-scheme` 兜底防白闪。主题令牌是 shadcn/ui 的 neutral 基色
（oklch 变量），**未做品牌化改动**。

## 语言三段式（`i18n/`）

与主题**同构**，理由相同：

1. `initLocale()`（同步，挂载前）：读 `cchub:locale` 缓存。
2. `useLocale()`（prefs 到位后）：以 `prefs.locale` 真值校正。
3. `applyLocale(locale)` 是唯一出口：改语言、改 `<html lang>`、写缓存。

**刻意不用** i18next 的浏览器语言探测插件 —— 语言只由 `prefs.locale` 单一驱动，
多一个真值源只会让「设置里选了英文但界面还是中文」这类问题难查。

### 词典类型化

`i18n/index.ts` 以 **zh-CN 词典为形状真值**：

```ts
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof zhCN };
  }
}
```

于是 `t("a.b.c")` 里的拼写错误与缺失键会在 `tsc --noEmit` 阶段报错。
`en-US` 缺键由 `scripts/check-locales.mjs` 兜底（同时校验 `{{占位符}}` 一致）。

### 后端消息的双语化

这是 i18n 里最核心的设计。Rust 命令不返回给人看的文案，而是返回结构化串
`{"code":"...","args":{...}}`。前端 `lib/errors.ts`：

- `describeError(raw)` → 查 `errors.*`（失败类）
- `describeNote(raw)` → 查 `notes.*`（状态 / 反馈 / 日志）

**保留参数会二次翻译**，这样后端就能把「嵌套语义」传过来：

| 参数名 | 二次查词典前缀 | 例子 |
| --- | --- | --- |
| `op` | `op.*` | 操作名 |
| `label` | `fields.*` | 字段名 |
| `hint` | `notes.*` | 提示 |
| `verb` | `verb.*` | 动词 |

查不到码时**原样透传原文** —— 宁可显示中文，也绝不露出 `errors.xxx` 键名或空白。

因此 `Result<T, String>` 的签名不用改（32 个命令零改动），
参数里的引号、中文、换行由 `serde_json` 转义，不会被撑破（`error.rs` 有专门的
「敌对参数不撑破 JSON」测试）。

## 页面速览

- **AppStore**：`EnvironmentBanner` + 搜索（匹配 name/vendor/tagline/description/tags）
  + 刷新按钮 + 卡片列表 `AppCard`；底部如实显示目录来源（remote / cache / builtin）。
- **Skills**：已安装卡（启停 Switch + 删除确认）+ 按 `category` 分组的可安装卡。
  分类是后端中文串，仅**展示层**经 `CATEGORY_KEYS` 翻译，匹配仍用原值。
- **Mcp**：`ServiceCard` → 选目标宿主 + 展开填 `argSpecs` / `envSpecs`
  （必填校验）+ 握手测试 + 移除确认。
- **ApiKeys**：`AddKeyCard`（provider Select + label + value）+ 按 provider 分组列表；
  KeyRow 支持测试徽章（ok/invalid/error）、reveal（10s 自动遮罩）、删除确认。
- **Routes**：每宿主一张 `HostCard` —— 目标文件路径、激活预设徽章、
  **drift 偏差告警 + 一键重新下发**；`RuleForm` 按 provider 自动预填
  `anthropicEndpoint` / `defaultModels`；预设级 `probeRoute` 测速；
  一键 `switchTo` / `clear` / `apply`。
- **Settings**：外观 / 行为 / 网络代理 / 目录源 / 环境诊断五张卡。
  开关类即时保存（diff），输入框失焦保存，代理改动自动重拉目录。

## 桌面应用特有的 CSS 细节

`globals.css` 里有若干为「桌面 App 而非网页」做的处理：

- `body { overflow: hidden; -webkit-user-select: none }` —— 禁选中，仅
  `input` / `textarea` / `[data-selectable]` 可选。
- 侧栏顶部用 `data-tauri-drag-region` 实现原生窗口拖拽。
- `@supports` 不与 `*` 规则嵌套（旧 WKWebView 会整条丢弃该规则）。
- 字体栈补 PingFang SC / 微软雅黑。
- 构建目标按平台区分：`vite.config.ts` 里 Windows → `chrome105`（WebView2），
  其他 → `safari16.4`（与 bundle 的 `minimumSystemVersion: 12.0` 对齐）。

## 组件复用现状

`AppCard`、`TaskLogPanel`（stream 着色 + 贴底滚动；仅 `info` 行过 `describeNote`，
stdout/stderr 是子进程原文，不翻译）、`EnvironmentBanner`、`PageHeader`、`Sidebar`
均复用良好。

一处**已知的重复**：只有 AppStore / Settings 用了 `PageHeader`，
Skills / Mcp / ApiKeys / Routes 各自内联复制了一份 sticky header 的 className，
是可以统一的技术债。

## UI 原语（Base UI）

`components/ui/` 是 vendored 的，不由 CLI 覆盖。从 registry 重新取源码
（`https://ui.shadcn.com/r/styles/base-vega/<name>.json`）时，有四处必须手工处理，
否则**静默失效**（能编译、能过构建，但样式或行为不对）：

1. **导入与自定义类要本地化**：registry 里的 `cn` 指向其内部别名、`IconPlaceholder`
   指向官网 create 应用、`cn-font-heading` / `cn-menu-target` / `cn-menu-translucent`
   是官网内部类。需换成 `@/lib/utils` 与 `lucide-react`，并删掉未定义的自定义类。
2. **`Separator` 的取向选择器**：Base UI 只发 `data-orientation="horizontal|vertical"`。
   注册表源码用的 `data-horizontal:` / `data-vertical:` 不生成任何 CSS，会让分隔线
   拿不到尺寸、渲染不可见 —— 必须写成 `data-[orientation=horizontal]:`。
3. **`AlertDialogAction` 不再隐式关闭**：Radix 的 `Action` 会自动收起对话框，Base UI
   版只是个普通 `Button`。凡是依赖旧行为的地方都要自己收状态，否则点确认后弹窗
   一直挂着（`AppCard` 卸载确认即属此类）。
4. **`Select` 的 `onValueChange` 会传 `string | null`**（清空时）。绑到 `string` 状态
   的地方要加空值守卫。
