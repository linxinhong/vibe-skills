# 任务技能与机械工具

architect 定义设计边界和任务卡；coding-owner 实现并完成已授权的集成；
task-integrator 审计进度、纠正状态并协调已授权的集成。
具体行为以各自 SKILL.md 为准，用户授权决定工作范围。

技能不设固定修复次数，不默认扩大到下一张卡，不因为风险标签重复请求批准。
任务卡采用 main 完成语义时，done 必须有合并、验收和记录证据。

## CLI

在目标仓库运行：

```sh
node ~/.agents/skills/task-integrator/bin/tasks.mjs report --md
node ~/.agents/skills/task-integrator/bin/tasks.mjs validate --registry <path>
node ~/.agents/skills/task-integrator/bin/tasks.mjs claim <ID> --registry <path> \
  --owner "<agent>#<unique-id>" --branch <branch> --worktree <absolute-path>
node ~/.agents/skills/task-integrator/bin/tasks.mjs preflight <ID> --registry <path>
node ~/.agents/skills/task-integrator/bin/tasks.mjs complete <ID> --registry <path> \
  --evidence-file <absolute-json-path>
```

Node ≥18，零外部依赖。list/show/report/validate/preflight 为只读命令；
ui 可启动只读看板，ui --export 可写出静态报告。
claim 和 complete 通过锁协调注册表变更并提交 main；它们不锁整个 Git 集成过程。
运行前检查暂存区，避免 git commit 携带无关修改。

发现范围是 .tasks/tasks.yaml 和 docs 下的 tasks.yaml；多注册表变更必须指定 --registry。
当前工具使用 main 和 YAML 子集，不是任意分支或任意 YAML 的通用工作流引擎。
不支持自动 reconcile；有授权时使用仓库工具或窄范围编辑并校验。
complete 只验证祖先关系等机械条件，不执行测试，也不证明证据真实。

证据 JSON 是数组，记录 type、check、status、summary，并标明实际验收提交。
默认 worktree 位置与忽略规则见 ../coding-owner/SKILL.md。

## 验证

```sh
node --test ~/.agents/skills/task-integrator/bin/tasks.test.mjs
```
