# DeepSeek 用量计费明细

在 DeepSeek 开放平台用量页面嵌入输入/输出计费明细的 Tampermonkey / ScriptCat 用户脚本。

## 效果

在 [platform.deepseek.com/usage](https://platform.deepseek.com/usage) 页面上，将输入/输出 token 和费用明细直接嵌入到现有卡片中：

**六月消费卡片**
```
¥10.25 输入 ¥8.59 / 输出 ¥1.69  CNY
```

**Tokens 行**
```
Tokens  217,813,838  输入 217,798,981 (缓存命中 98.0%) / 输出 845,806
```

无需额外面板，不占空间，完全融入页面原有布局。

## 安装

### 前置条件

安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [ScriptCat](https://scriptcat.org/) 浏览器扩展。

### 方法一：直接安装（推荐）

👉 **[点击安装](https://github.com/studentWu666/deepseek-usage-pricing/raw/main/deepseek-usage-pricing.user.js)**

### 方法二：手动导入

1. 下载 `deepseek-usage-pricing.user.js`
2. 打开 Tampermonkey → 管理面板 → 实用工具 → 导入
3. 选择下载的文件并安装

## 功能

- 📊 **费用拆分**：显示输入（缓存命中 + 未命中）和输出的费用明细
- 🔤 **Token 拆分**：显示输入/输出 token 数及缓存命中率
- 🔄 **自动加载**：拦截 API + 主动拉取 + DOM 监听三重保障，刷新即时显示
- 🧩 **嵌入式**：直接嵌在页面现有卡片中，不额外占用空间

## 数据来源

脚本从 DeepSeek 用量页面后台 API 获取数据：
- `/api/v0/usage/amount` — Token 用量
- `/api/v0/usage/cost` — 费用明细

数据仅在你浏览器本地处理，不上传任何第三方。

## 兼容性

- ✅ Tampermonkey
- ✅ ScriptCat
- ✅ Microsoft Edge
- ✅ Google Chrome
- ✅ Firefox (需 Tampermonkey)

## 许可证

MIT
