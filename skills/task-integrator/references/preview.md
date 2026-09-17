# 通用项目进度预览

任务支持可选字段 `recommended_model: "gpt-6 astra"`（YAML/JSON 通用；JSON
也接受 `recommendedModel`）。模型名称是可扩展显示文本，不限制厂商或别名。
Architect 为新卡按任务难度推荐，不自动给历史卡补值。

看板与概览中的任务摘要：`in_progress` 显示 `接管 Agent：<owner>`；其他状态
显示 `推荐：<recommended_model>`。实际接管者取现有 `owner` / `result.owner`，
不从推荐字段推断。旧卡缺推荐显示 `推荐：未指定`，进行中缺 Owner 显示
`接管 Agent：未记录`。详情继续保留历史负责人；搜索可匹配推荐模型。
推荐不等于运行时模型 ID 或可用性保证，不影响权限、依赖或领取条件。

Node 18+，零外部运行依赖。`preview.mjs` 及同目录 supporting modules 一起使用。

```sh
node ~/.agents/skills/task-integrator/bin/preview.mjs --root /path/to/project --open
node ~/.agents/skills/task-integrator/bin/preview.mjs --root /path/to/project --live --open
node ~/.agents/skills/task-integrator/bin/preview.mjs --root /path/to/project --data snapshot.json --base trunk
node ~/.agents/skills/task-integrator/bin/preview.mjs --root /path/to/project --architecture docs/architecture.md --open
```

相对输入和输出路径均基于 `--root`（默认当前目录）。默认输出 `.tasks/preview.html`；
`--out` 指定其他 HTML。输入可用 `--registry` 指定现有 tasks CLI 支持的 YAML 子集，
或 `--data` 指定 JSON。自动发现遇到零个或多个账本时要求显式选择。
`--roadmap` 指定里程碑 JSON，默认读取存在的 `.tasks/roadmap.json`。
`--architecture` 指定 Markdown 架构文档，默认读取存在的 `.tasks/architecture.md`。

页面标题和依赖图根节点采用 `project.name`。YAML 与 JSON 都建议显式提供
`project.name` 与可选的 `project.status`；`feature.title`、`feature.status` 表达当前交付主题，
仅作为旧账本缺少 `project.name` 时的兼容回退，不应替代项目身份。

## JSON 输入

可运行样例位于 `assets/preview-example.json`。用 `--data` 指向其绝对路径即可预览，
样例包含中文和非 TASK 格式 ID、开发/验证/验收分类和待排期里程碑。

```json
{
  "project": { "name": "Example Project" },
  "tasks": [
    {
      "id": "ISSUE-7",
      "title": "完成登录旅程",
      "status": "in_progress",
      "owner": "agent-a",
      "kind": "development",
      "group": "Identity",
      "dependencies": [],
      "goal": "用户可以登录并退出",
      "acceptance": [{ "expect": "退出后受保护页面拒绝访问" }],
      "evidence": [],
      "branch": "feature/login",
      "worktree": "../project-login"
    }
  ],
  "milestones": [
    {
      "id": "first-release",
      "title": "首次可用版本",
      "tasks": ["ISSUE-7"],
      "verificationTasks": [],
      "plannedDate": "",
      "group": "Product"
    }
  ]
}
```

任务 ID 是唯一非空字符串；title、status 等缺失时明确显示未知。
状态支持 ready / in_progress / awaiting_integration / pending / blocked /
needs_arch_review / failed / done；其他状态显示未映射，不擅自转换。
kind 可用 development / verification / acceptance；没有显式值则未分类。
日期使用 ISO 8601；任务完成日期字段为 completedAt，也兼容 result.completed_at。
owner、branch、worktree、evidence 兼容 result 下的现有字段。

里程碑文件格式为 `{ "milestones": [...] }`，存在时替代输入内的 milestones。
里程碑 release 需要同时提供 date 和 evidence，例如
`{"date":"2026-10-01","evidence":"release record v1"}`；否则不显示已发布。
任务完成日期仅用于完成历史。没有路线图时展示历史与待排期任务，不生成猜测日期。

## Git 和本机模式

基准选择为 --base、origin/HEAD、本地 init.defaultBranch、main、master；均无时显示未知。
Git 不存在或不可用时仍可查看任务。任务分支/worktree 优先显式匹配；未提供时按 ID
边界匹配 Git worktree 清单，多候选必须选择。有新提交不自动变为待集成。

实时模式只监听 127.0.0.1，轮询 3 秒，Git/状态缓存 10 秒。支持分支历史每页 30 条、
提交文件增删统计，以及显式点击打开已登记工作区的系统文件管理器；没有 Git 写入接口。
打开请求校验 Host、Origin 和会话 token，服务端重查 worktree 白名单。
静态导出保存前 20 个未完成且有明确分支 HEAD 的任务历史，每支最多 30 条、前 3 条文件统计；
其余历史提示使用实时模式。所有完整任务卡与证据仍被保留。分享前检查本地路径和证据内容。

## 技能协作

Architect 在获授权的规划中维护可选里程碑映射，Task Integrator 核对状态与发布证据，
Business Verifier 提供真实验收记录。工具不修改任务状态，也不从标题猜测验证结果。
项目概览、任务看板、从左向右按需展开的依赖思维导图和架构文档通过紧凑的左侧图标导航切换。
依赖图默认从 `TASK-001`（若存在）开始，包含已完成任务并逐层展开完整主干；其他无前置依赖的
独立任务线通过“显示其他根任务”按需加入，避免一进入图谱就失去项目起点。
节点状态以标签显示。键盘聚焦节点后可用上/下方向键在可见节点间移动，右方向键展开一层，
左方向键收起当前分支；空格在“展开整个右侧子树”和“收回到当前节点”之间切换。
顶部标题栏横跨全宽，紧凑图标侧栏从标题栏下方开始；任务搜索位于标题区右上方。
任务账本路径、总体状态和重复完成统计不占用界面。状态列本身承担进度筛选语义，
不额外堆叠负责人和状态工具栏；主题切换位于侧栏底部。里程碑输入仅为旧数据兼容保留，
不再提供独立产品路线视图。架构文档在本地
安全渲染常用 Markdown（标题、列表、引用、代码块、表格和链接），不执行文档内 HTML
或脚本。视图偏好保存在浏览器，按输入文件路径隔离。外部任务系统通过上述 JSON 转换接入。

测试：`node --test <skill-dir>/bin/preview.test.mjs`。
