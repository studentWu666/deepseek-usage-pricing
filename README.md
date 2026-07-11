# DeepSeek 用量计费明细

在 DeepSeek 开放平台用量页面自动显示费用和 Token 明细的 Tampermonkey 用户脚本。

## 效果

在 [platform.deepseek.com/usage](https://platform.deepseek.com/usage) 页面的用量卡片上方自动插入一个横幅，显示：

```
💰 费用明细   缓存命中 ¥7.18   未命中 ¥12.27   输出 ¥2.38   合计 ¥21.83  |  📊 Token 明细   输入 369.47M (命中 363.04M / 未命中 6.43M)   输出 1.10M   缓存率 98.2%
```

横幅使用 DeepSeek 原生 CSS 变量，自动适配 light / dark 主题。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 👉 **[点击安装脚本](https://github.com/studentWu666/deepseek-usage-pricing/raw/main/deepseek-usage-pricing.user.js)**
3. 打开 [用量页面](https://platform.deepseek.com/usage) 即可看到横幅

## 功能

- 📊 **费用拆分**：缓存命中 / 未命中 / 输出三档费用 + 合计
- 🔤 **Token 明细**：输入(命中/未命中) + 输出 + 缓存率
- 🎨 **主题适配**：使用 `--dsw-alias-*` CSS 变量，自动跟随 light/dark
- 🔄 **三重保障**：fetch 拦截 + XHR 拦截 + MutationObserver
- 📱 **响应式**：flex-wrap 适配窄屏

## 数据来源

拦截页面后台 API 响应，支持两种格式：
- 新版 `by_api_key/amount` — series[].buckets[].usage
- 旧版 `amount?month=` — total[].usage[].amount

数据仅在浏览器本地处理，不上传任何第三方。

## 定价

| 模型 | 缓存命中 (¥/M) | 未命中 (¥/M) | 输出 (¥/M) |
|------|----------------|--------------|------------|
| deepseek-v4-flash | 0.02 | 1.00 | 2.00 |
| deepseek-v4-pro | 0.025 | 3.00 | 6.00 |

## 兼容性

- ✅ Tampermonkey (Chrome / Edge / Firefox)
- ✅ ScriptCat

## 许可证

MIT
