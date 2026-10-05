# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

本仓库的域文档布局在初始化时与用户确认为 **multi-context**：子项目各一份 `CONTEXT.md`，根目录一份
`CONTEXT-MAP.md` 指向它们。本次初始化不创建 `CONTEXT-MAP.md` 与各子项目的 `CONTEXT.md`，留到第一次
真正写下词条时再建，届时由仓库根目录的 `CONTEXT-MAP.md` 指向它们。

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root once it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`CONTEXT.md`** in the context(s) you are about to work in.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In this multi-context repo, also check each context's own `docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context repo (this repo — presence of `CONTEXT-MAP.md` at the root, to be created lazily):

```
/
├── CONTEXT-MAP.md                     ← 指向各子项目的 CONTEXT.md（首次写词条时建）
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── features/
    │   └── wizard/
    │       ├── CONTEXT.md             ← 各子项目自己的词条表（首次写词条时建）
    │       └── docs/adr/              ← context-specific decisions
    ├── services/
    │   └── CONTEXT.md
    └── stores/
        └── CONTEXT.md
```

> 上面只是 multi-context 布局的形状示例。本次初始化不建任何 `CONTEXT.md` / `CONTEXT-MAP.md` /
> `docs/adr/`；具体哪几个 context 各有一份 `CONTEXT.md`，等第一次真正写下词条时由
> `/domain-modeling` 决定并登记进根目录的 `CONTEXT-MAP.md`。

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
