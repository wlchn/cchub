# 模块 · Skill 管理

> 页面 `/skills`。对应的 Rust 模块：`src-tauri/src/skills.rs`。

## 职责

Skill 是给编码智能体加装的能力包。本模块管「找到 + 装好 + 管住」三件事：
浏览白名单里的 Skill 源、安装到用户级目录、软禁用/启用、卸载。

## 安装源目录

`SKILL_SOURCES` 共 **30 条**，来自两个经过克隆验证的仓库：

| 仓库 | 数量 | 内容 |
| --- | --- | --- |
| `anthropics/skills`（官方） | 16 | 文档（docx/xlsx/pptx/pdf）、设计（frontend-design / brand-guidelines / theme-factory / canvas-design / algorithmic-art）、工程（mcp-builder / skill-creator / webapp-testing / web-artifacts-builder / claude-api）、写作（internal-comms / doc-coauthoring） |
| `obra/superpowers`（社区工程方法论） | 14 | brainstorming、writing/executing-plans、TDD、systematic-debugging、verification、code-review 收发、subagent/parallel-agents、git-worktrees、分支收尾等 |

> README / ROADMAP 写「33 个」，代码实为 30 条 —— 以代码为准。

```rust
pub struct SkillSource {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,   // 文档 / 工程 / 设计 / 写作
    pub repo: &'static str,       // git URL
    pub subdir: &'static str,     // 仓库内路径
}
```

`category` 是后端中文串。前端**只在展示层翻译**（`CATEGORY_KEYS` /
`categoryLabel`），分组匹配仍用后端原值，未知分类回落原文。

## 命令

| 命令 | 作用 |
| --- | --- |
| `list_skills()` | 扫描安装目录，返回已安装 Skill |
| `list_skill_sources()` | 返回白名单源目录 |
| `install_skill(id)` | 按 id 查白名单并克隆安装 |
| `set_skill_enabled(id, enabled)` | 启停 |
| `uninstall_skill(id)` | 卸载 |

```rust
pub struct SkillEntry { pub id: String, pub meta: SkillMeta, pub enabled: bool, pub path: String }
pub struct SkillMeta  { pub name: String, pub description: String }
```

## 关键设计

### 软禁用：`.disabled` 后缀

启停**不删内容**，只在目录名后缀加减 `.disabled`（常量 `DISABLED_SUFFIX`）。
智能体扫描 skills 目录时天然会跳过带后缀的目录，所以这是零成本、可逆的禁用。

卸载时会同时匹配带后缀与不带后缀的变体。

### 路径逃逸防护

`ensure_under_root` 先 `canonicalize` 再对 skills 根做**前缀比较**，拒绝 `../`
逃逸（错误码 `pathOutsideSkills`）。启停与卸载前均调用。
测试 `escapes_are_rejected_by_ensure_under_root` 覆盖。

### 安装流程

1. 按 id 查 `SKILL_SOURCES` 拿到 repo 与 subdir（前端拼不进地址）
2. 校验 `repo.starts_with("https://")`（否则 `skillSourceNotHttps`）
3. `git clone --depth 1` 到临时目录（走代理、仅 https）
4. **仓库布局自适应**：若 subdir 直接含 `SKILL.md` 则搬单体；否则搬所有含
   `SKILL.md` 的一级子目录 —— 同时适配单 Skill 仓库与 monorepo
5. clone 后必须存在 `SKILL.md`，否则报 `repoHasNoSkill`
6. 移入正式目录

`TempDirGuard` 用 `Drop` 保证临时目录一定被清理。`move_skill_dir` 同名覆盖 =
重装语义；`rename` 跨设备失败时回落 `copy_dir_recursive`。

### 解析失败不报错

`scan_skills` 把 frontmatter 坏掉的 Skill **降级**为描述「（frontmatter 解析失败）」
而不是让整个列表失败。跳过不含 `SKILL.md` 的目录。

## 前端

- 页面：`src/pages/Skills.tsx`；store：`src/store/skills.ts`
- 两张卡：**已安装**（启停 Switch + 删除确认弹窗 + 路径展示）与
  **可安装目录**（按 category 分组）
- `setEnabled` 是乐观更新 + 失败回滚

## 测试覆盖

`parses_frontmatter`、`rejects_missing_frontmatter`、`rejects_unterminated_frontmatter`、
`rejects_missing_name`、`source_ids_are_unique`、`all_sources_are_https`、
`sources_point_at_expected_repos`（只信任两个仓库）、`subdir_paths_are_safe`
（禁绝对路径与 `..`）、`escapes_are_rejected_by_ensure_under_root`。
