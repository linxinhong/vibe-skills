# Vibe Skills

面向 Agent Coding 项目的五技能协作套件，将架构、界面交付、任务执行、业务验证和集成审计放在同一套可版本化工作流中。

## 包含的技能

| 技能 | 职责 |
| --- | --- |
| `architect` | 定义架构边界和可执行任务卡 |
| `ui-delivery` | 提供可视交互方案并完成浏览器验收 |
| `coding-owner` | 领取任务、隔离开发、分层验证和证据交付 |
| `business-verifier` | 在可运行里程碑执行 Agent 业务验证 |
| `task-integrator` | 审计进度、集成证据、依赖关系和可领取任务 |

五个目录必须作为一个套件维护，因为它们通过 `../<skill-name>/...` 相互引用。`ui-delivery` 的浏览器操作可选依赖外部 `agent-browser` 技能；缺少它时按照技能内声明使用可用的浏览器替代工具。

## 安装

将 `skills/` 下的五个目录同步到 Agent 技能目录：

```sh
rsync -a skills/ ~/.agents/skills/
```

安装前检查目标目录中的本地修改。此命令会用本仓库同名文件覆盖目标技能文件，但不会删除目标目录中的额外文件。

## 校验

逐个执行 Codex Skill Creator 的结构校验，并运行套件自带测试：

```sh
for skill in architect ui-delivery coding-owner business-verifier task-integrator; do
  python3 ~/.agents/skills-out/anthropics/skills/skill-creator/scripts/quick_validate.py "skills/$skill"
done

node --test skills/ui-delivery/test/preview.test.mjs
node --test skills/task-integrator/bin/preview.test.mjs skills/task-integrator/bin/tasks.test.mjs
python3 -m unittest skills/coding-owner/scripts/test_worktree_kit.py
```

## 维护约定

- 以本仓库为版本化源，修改技能入口时同步维护其直接引用的 references、scripts、assets 和测试。
- 保持五个技能的相对目录关系，不把单个 `SKILL.md` 脱离资源单独发布。
- 任务对外展示统一使用“任务名称（TASK-ID）”，命令、路径和结构化字段继续使用原始 ID。
- 提交前运行上述结构校验和相关测试；生成缓存、预览输出和本机敏感资料不进入版本库。
