# AI 翻译

基于 AI 视觉模型的 [uiauto.dev](https://github.com/uiautodev/uiautodev) 插件：截取设备当前画面，自动识别界面文字并翻译，结果以「原文 / 译文」左右分栏流式展示。

## 功能

- **截屏翻译** — 一键截取当前设备画面，交给视觉大模型做 OCR + 翻译，无需手动输入文本
- **流式输出** — 边接收边解析，翻译结果逐条实时显示
- **多语言** — 支持中文、English、日本語、한국어、Français、Deutsch、Español、Русский、العربية，按钮文案随目标语言自动切换
- **智能过滤** — 自动跳过图标、纯数字、时间戳、URL、代码；已是目标语言的文字不再翻译
- **一键复制** — 点击任意条目即可复制译文
- **用时统计** — 翻译完成后显示条目数与总耗时

## 使用

1. 在 uiauto.dev 中打开插件面板
2. 选择目标语言
3. 点击「翻译屏幕」按钮
4. 稍等片刻，界面文字会逐条出现在下方列表中，点击条目复制译文

## 项目结构

```
├── plugin.json          # 插件元信息（名称、版本、描述）
├── app.tsx              # 插件逻辑入口
├── index.html           # 插件 UI 入口
├── styles.css           # Tailwind 样式源文件
├── tailwind.config.js   # Tailwind 配置（含 darkMode: 'class'）
├── app.js               # 编译产物（由 app.tsx 打包）
├── app.css              # 编译产物（由 styles.css 生成）
└── plugin-runtime.d.ts  # 平台 API 类型定义
```

## 开发命令

```bash
npm install          # 安装依赖（首次运行前执行）
npm run fetch-types  # 拉取最新的类型定义（需 uiauto.dev 运行中）
npm run dev          # 开发模式，同时监听 app.tsx 与 styles.css
npm run build        # 编译为 app.js 和 app.css
npm run build:css    # 仅重新生成 app.css
npm run format       # 使用 prettier 格式化代码
```

## 实现说明

插件通过 `$u` 全局对象访问平台能力（详见 `plugin-runtime.d.ts`）：

- `$u.screenshotAsBase64()` — 获取当前设备画面
- `$u.openai()` — 调用已配置的 OpenAI 兼容接口（开启 `stream`，并设置 `reasoning_effort: 'none'` 关闭思考）
- 模型按 JSON Lines 逐行返回 `["原文","译文"]`，插件按行解析并实时渲染

## 技术栈

- **Preact** — 轻量 UI 框架
- **TypeScript** — 类型安全
- **Tailwind CSS** — v3，语义化 CSS 变量自动适配明暗主题
- **lucide-preact** — 图标库
- **esbuild** — 快速编译打包

## License

[MIT](./LICENSE)
