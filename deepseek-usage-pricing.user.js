// ==UserScript==
// @name         DeepSeek 用量计费明细（嵌入式）
// @namespace    https://platform.deepseek.com/usage
// @version      1.4
// @description  在用量页面将输入/输出计费嵌入现有卡片中
// @author       Reasonix
// @match        https://platform.deepseek.com/usage
// @icon         https://platform.deepseek.com/favicon.ico
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /* ==============================
       0. 拦截器 — 在页面 JS 执行前注入
       ============================== */

    let dsAmount = null;
    let dsCost = null;
    let dsToken = null;      // 存 auth token 供兜底重试
    let dsMonth = 6;
    let dsYear = 2026;

    // ── 拦截 fetch ──
    const __origFetch = window.fetch;
    window.fetch = function (...args) {
        const req = args[0];
        const url = (typeof req === 'string' ? req : req?.url) || '';
        const opts = typeof req === 'object' && !(typeof args[1] === 'object') ? req : args[1];

        // 提取 auth token
        if (!dsToken) {
            const auth = opts?.headers?.authorization || opts?.headers?.Authorization;
            if (auth) dsToken = auth;
        }

        const resp = __origFetch.apply(this, args);
        if (url.includes('/api/v0/usage/amount')) {
            return resp.then(r => r.clone().json().then(d => { dsAmount = d; return r; }).catch(() => r));
        }
        if (url.includes('/api/v0/usage/cost')) {
            return resp.then(r => r.clone().json().then(d => { dsCost = d; scheduleEmbed(); return r; }).catch(() => r));
        }
        return resp;
    };

    // ── 拦截 XMLHttpRequest ──
    const __open = XMLHttpRequest.prototype.open;
    const __send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, url) {
        this._dsUrl = (typeof url === 'string' ? url : url?.toString()) || '';
        return __open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = (function (orig) {
        return function (name, value) {
            if (!dsToken && /^authorization$/i.test(name)) dsToken = value;
            return orig.apply(this, arguments);
        };
    })(XMLHttpRequest.prototype.setRequestHeader);

    XMLHttpRequest.prototype.send = function (...a) {
        if (this._dsUrl.includes('/api/v0/usage/amount')) {
            this.addEventListener('load', function () {
                try { dsAmount = JSON.parse(this.responseText); } catch (e) { /* ignore */ }
            });
        }
        if (this._dsUrl.includes('/api/v0/usage/cost')) {
            this.addEventListener('load', function () {
                try { dsCost = JSON.parse(this.responseText); scheduleEmbed(); } catch (e) { /* ignore */ }
            });
        }
        return __send.apply(this, a);
    };

    /* ==============================
       1. 嵌入核心（与拦截器无关）
       ============================== */

    function safeNum(v) {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? Math.max(n, 0) : 0;
    }

    function findTextEl(text) {
        // 优先找无子元素的纯文本节点
        const all = document.querySelectorAll('*');
        for (const el of all) {
            if (el.tagName === 'TH') continue;
            if (el.textContent?.trim() === text && !el.querySelector('*')) return el;
        }
        // 放宽
        for (const el of all) {
            if (el.tagName === 'TH') continue;
            if (el.textContent?.trim() === text && el.children.length <= 1) return el;
        }
        return null;
    }

    function doEmbed() {
        const amtBody = dsAmount?.data?.biz_data;
        const costArr = dsCost?.data?.biz_data?.[0];     // usage/cost 返回数组
        if (!amtBody || !costArr) return false;

        const amtTotal = amtBody.total || [];
        const costTotal = costArr.total || [];

        const mTotal = amtTotal.find(m =>
            (m.usage || []).reduce((s, x) => s + safeNum(x.amount), 0) > 0
        );
        if (!mTotal) return false;
        const cTotal = costTotal.find(m => m.model === mTotal.model);
        if (!cTotal) return false;

        const usage = {};
        for (const u of mTotal.usage) usage[u.type] = safeNum(u.amount);
        const costMap = {};
        for (const u of cTotal.usage) costMap[u.type] = safeNum(u.amount);

        const cacheHit = usage['PROMPT_CACHE_HIT_TOKEN'] || 0;
        const cacheMiss = usage['PROMPT_CACHE_MISS_TOKEN'] || 0;
        const outputT = usage['RESPONSE_TOKEN'] || 0;
        const totalInput = cacheHit + cacheMiss;

        const inputCost = (costMap['PROMPT_CACHE_HIT_TOKEN'] || 0) + (costMap['PROMPT_CACHE_MISS_TOKEN'] || 0);
        const outputCost = costMap['RESPONSE_TOKEN'] || 0;

        const cacheRate = totalInput > 0
            ? ((cacheHit / totalInput) * 100).toFixed(1) + '%'
            : '-';

        let ok = false;

        // ── 六月消费卡片（同行内联） ──
        const costLabel = findTextEl('六月消费（按 UTC+0 时间）');
        if (costLabel && !document.querySelector('.ds-cost-breakdown')) {
            const amtRow = costLabel.parentElement?.querySelector('._7ed1d04');
            if (amtRow) {
                const s = document.createElement('span');
                s.className = 'ds-cost-breakdown';
                s.textContent = `输入 ¥${inputCost.toFixed(2)} / 输出 ¥${outputCost.toFixed(2)}`;
                // 插在最后一个 span（金额数字）后面
                const lastSpan = amtRow.querySelector('span:last-child');
                if (lastSpan) lastSpan.after(s);
                else amtRow.appendChild(s);
                ok = true;
            }
        }

        // ── Tokens 区域（同行内联） ──
        const tLabel = findTextEl('Tokens');
        if (tLabel && !document.querySelector('.ds-token-breakdown')) {
            const flexRow = tLabel.closest('[style*="baseline"]') || tLabel.parentElement;
            if (flexRow) {
                const s = document.createElement('span');
                s.className = 'ds-token-breakdown';
                s.textContent = `输入 ${totalInput.toLocaleString()} (缓存命中 ${cacheRate}) / 输出 ${outputT.toLocaleString()}`;
                // 插在最后一个 span（数字）后面
                const lastSpan = flexRow.querySelector('span:last-child');
                if (lastSpan) lastSpan.after(s);
                else flexRow.appendChild(s);
                ok = true;
            }
        }

        // 清理旧版大面板
        document.querySelector('#ds-pricing-breakdown')?.remove();
        return ok;
    }

    /* ==============================
       2. 调度策略
       ============================== */

    let retries = 0;
    const MAX_RETRIES = 30;  // 15 秒

    function scheduleEmbed() {
        if (retries >= MAX_RETRIES) return;
        if (doEmbed()) {
            console.log('[DS Pricing] ✅ 已嵌入');
            retries = 0;
            return;
        }
        retries++;
        setTimeout(scheduleEmbed, 500);
    }

    // ── 兜底：通过 MutationObserver 监听目标元素出现后重试 ──
    function watchForTargets() {
        const seen = new Set();
        const obs = new MutationObserver(() => {
            for (const text of ['六月消费（按 UTC+0 时间）', 'Tokens']) {
                if (seen.has(text)) continue;
                if (findTextEl(text)) {
                    seen.add(text);
                    // 目标元素已出现，触发嵌入
                    scheduleEmbed();
                }
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        // 自动断开，不无限监听
        setTimeout(() => obs.disconnect(), 20000);
    }

    // ── 兜底：直接调用 API（仅当存了 token 且拦截器没抓到数据时） ──
    async function fallbackFetch() {
        if (dsAmount && dsCost) return;
        if (!dsToken) {
            // 还没拿到 token，等一会再试
            setTimeout(fallbackFetch, 1500);
            return;
        }
        try {
            const headers = { authorization: dsToken, 'x-client-platform': 'web', 'x-app-version': '1.0.0' };
            if (!dsAmount) {
                const r = await fetch(`/api/v0/usage/amount?month=${dsMonth}&year=${dsYear}`, { headers, credentials: 'same-origin' });
                if (r.ok) dsAmount = await r.json();
            }
            if (!dsCost) {
                const r = await fetch(`/api/v0/usage/cost?month=${dsMonth}&year=${dsYear}`, { headers, credentials: 'same-origin' });
                if (r.ok) dsCost = await r.json();
            }
            if (dsAmount && dsCost) scheduleEmbed();
        } catch (e) {
            console.warn('[DS Pricing] fallback 请求失败:', e);
        }
    }

    /* ==============================
       3. 启动
       ============================== */

    // 页面加载完成后执行
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

    function init() {
        // 注入全局样式
        const style = document.createElement('style');
        style.textContent = `
            .ds-cost-breakdown,.ds-token-breakdown{
                font-size:11px!important;color:#6a7a9a!important;
                font-weight:400!important;margin-left:8px!important;
            }
        `;
        document.head.appendChild(style);

        // 启动 MutationObserver 监视 DOM
        watchForTargets();

        // 数据已就绪则直接嵌入
        if (dsAmount && dsCost) {
            scheduleEmbed();
        }

        // 兜底：3 秒后如果还没嵌入，尝试主动拉 API
        setTimeout(() => {
            if (!document.querySelector('.ds-cost-breakdown') && !document.querySelector('.ds-token-breakdown')) {
                fallbackFetch();
            }
        }, 3000);
    }

    // SPA 路由变化重置
    const __pushState = history.pushState;
    history.pushState = function () {
        __pushState.apply(this, arguments);
        retries = 0;
        dsAmount = null;
        dsCost = null;
        setTimeout(() => {
            watchForTargets();
            scheduleEmbed();
            setTimeout(fallbackFetch, 2000);
        }, 500);
    };
})();
