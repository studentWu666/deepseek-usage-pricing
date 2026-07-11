// ==UserScript==
// @name         DeepSeek 用量计费明细
// @namespace    https://platform.deepseek.com/usage
// @version      3.7
// @description  在用量卡片上方插入费用和 Token 明细横幅
// @author       Reasonix
// @match        https://platform.deepseek.com/usage*
// @icon         https://platform.deepseek.com/favicon.ico
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const PRICING = {
        'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1.00, output: 2.00 },
        'deepseek-v4-pro':   { cacheHit: 0.025, cacheMiss: 3.00, output: 6.00 },
    };
    function getPrice(n) {
        n = (n || '').toLowerCase();
        if (PRICING[n]) return PRICING[n];
        if (/flash|chat|reasoner/.test(n)) return PRICING['deepseek-v4-flash'];
        if (/pro/.test(n)) return PRICING['deepseek-v4-pro'];
        return null;
    }
    function fmt(v) {
        if (v == null || isNaN(v)) return '¥0.00';
        return '¥' + (Math.abs(v) < 0.01 ? v.toFixed(4) : v.toFixed(2));
    }
    function fmtTk(v) {
        if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
        if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
        return String(v);
    }

    /* ========================================================
       API 拦截
       ======================================================== */
    let _amt = null;

    const _f = window.fetch;
    window.fetch = function (...a) {
        const u = (typeof a[0] === 'string' ? a[0] : a[0]?.url) || '';
        const r = _f.apply(this, a);
        if (u.includes('/api/v0/usage/') && u.includes('/amount')) {
            return r.then(x => x.clone().json().then(d => { _amt = d; schedule(); return x; }).catch(() => x));
        }
        return r;
    };

    const _xo = XMLHttpRequest.prototype.open;
    const _xs = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
        this._u = (typeof u === 'string' ? u : u + '') || '';
        return _xo.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (...a) {
        if (this._u.includes('/api/v0/usage/') && this._u.includes('/amount')) {
            const self = this;
            self.addEventListener('load', function () {
                try { _amt = JSON.parse(self.responseText); schedule(); } catch (e) {}
            });
        }
        return _xs.apply(this, a);
    };

    /* ========================================================
       解析
       ======================================================== */
    function sv(v) {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? Math.max(n, 0) : 0;
    }

    function parseTokens() {
        if (!_amt) return null;
        const body = _amt?.data?.biz_data;
        if (!body) return null;

        let cacheHit = 0, cacheMiss = 0, output = 0, model = 'deepseek-v4-flash';

        if (body.series) {
            for (const s of body.series) {
                model = s.model || model;
                for (const b of (s.buckets || [])) {
                    const u = b.usage || {};
                    cacheHit  += sv(u.PROMPT_CACHE_HIT_TOKEN);
                    cacheMiss += sv(u.PROMPT_CACHE_MISS_TOKEN);
                    output    += sv(u.RESPONSE_TOKEN);
                }
            }
        } else if (Array.isArray(body) && body[0]?.total) {
            for (const m of body[0].total) {
                if (m.usage?.some(u => sv(u.amount) > 0)) model = m.model || model;
                for (const u of (m.usage || [])) {
                    const v = sv(u.amount);
                    if (u.type === 'PROMPT_CACHE_HIT_TOKEN')  cacheHit  += v * 1_000_000;
                    if (u.type === 'PROMPT_CACHE_MISS_TOKEN') cacheMiss += v * 1_000_000;
                    if (u.type === 'RESPONSE_TOKEN')          output    += v * 1_000_000;
                }
            }
        }

        if (cacheHit + cacheMiss + output === 0) return null;
        return { model, cacheHit, cacheMiss, output };
    }

    /* ========================================================
       注入 — 在三个卡片上方插入横幅
       ======================================================== */
    let injected = false;

    function inject() {
        if (injected) return;

        const t = parseTokens();
        if (!t) return;

        const price = getPrice(t.model);
        if (!price) return;

        const cacheHitFee  = (t.cacheHit  / 1_000_000) * price.cacheHit;
        const cacheMissFee = (t.cacheMiss / 1_000_000) * price.cacheMiss;
        const outputFee    = (t.output    / 1_000_000) * price.output;
        const totalFee     = cacheHitFee + cacheMissFee + outputFee;
        const totalInput   = t.cacheHit + t.cacheMiss;
        const cacheRate    = totalInput > 0 ? ((t.cacheHit / totalInput) * 100).toFixed(1) : '0';

        // 找三个卡片的父容器（包含"消费金额""API 请求次数""Tokens"的 grid）
        // 结构: .c7197b0d > .bba7a154 * 3
        let grid = null;
        const all = document.querySelectorAll('*');
        for (const el of all) {
            const children = el.children;
            if (children.length >= 3) {
                let hasCost = false, hasTokens = false;
                for (const c of children) {
                    const txt = c.textContent?.trim() || '';
                    if (txt.startsWith('消费金额')) hasCost = true;
                    if (txt.startsWith('Tokens') && !txt.includes('100,000')) hasTokens = true;
                }
                if (hasCost && hasTokens) { grid = el; break; }
            }
        }

        if (!grid) return;
        if (document.querySelector('#ds-pricing-banner')) { injected = true; return; }

        // 创建横幅 — 使用 DeepSeek CSS 变量与页面卡片风格统一
        const banner = document.createElement('div');
        banner.id = 'ds-pricing-banner';
        banner.style.cssText = `
            display: flex;
            gap: 24px;
            flex-wrap: wrap;
            margin-bottom: 16px;
            padding: 16px 20px;
            border-radius: 12px;
            background: var(--dsw-alias-bg-layer-2, #fff);
            border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.04));
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            line-height: 1.6;
            color: var(--dsw-alias-label-secondary, #6a7a9a);
        `;

        const brandColor = 'var(--dsw-alias-brand-primary, #3964fe)';

        banner.innerHTML = `
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;flex:1;min-width:240px;">
                <span style="font-weight:600;color:${brandColor};white-space:nowrap;font-size:14px;">💰 费用明细</span>
                <span><span style="color:#22c55e;">缓存命中</span> <b style="color:var(--dsw-alias-label-primary,#000);">${fmt(cacheHitFee)}</b></span>
                <span><span style="color:#f59e0b;">未命中</span> <b style="color:var(--dsw-alias-label-primary,#000);">${fmt(cacheMissFee)}</b></span>
                <span><span style="color:#3b82f6;">输出</span> <b style="color:var(--dsw-alias-label-primary,#000);">${fmt(outputFee)}</b></span>
                <span style="border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,0.1));padding-left:12px;">
                    <b style="color:var(--dsw-alias-label-primary,#000);">合计 ${fmt(totalFee)}</b>
                </span>
            </div>
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;flex:1;min-width:240px;border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,0.08));padding-left:20px;">
                <span style="font-weight:600;color:${brandColor};white-space:nowrap;font-size:14px;">📊 Token 明细</span>
                <span>输入 <b style="color:var(--dsw-alias-label-primary,#000);">${fmtTk(totalInput)}</b> (命中 ${fmtTk(t.cacheHit)} / 未命中 ${fmtTk(t.cacheMiss)})</span>
                <span>输出 <b style="color:var(--dsw-alias-label-primary,#000);">${fmtTk(t.output)}</b></span>
                <span>缓存率 <b style="color:${brandColor};">${cacheRate}%</b></span>
            </div>
        `;

        grid.parentElement?.insertBefore(banner, grid);

        injected = true;
        console.log('[DS] ✅ 横幅已注入',
            '合计', fmt(totalFee),
            '输入', fmtTk(totalInput),
            '命中率', cacheRate + '%');
    }

    /* ========================================================
       调度
       ======================================================== */
    let timer = null;
    let count = 0;

    function schedule() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            inject();
            if (!injected && count++ < 120) schedule();
        }, 500);
    }

    function boot() {
        const obs = new MutationObserver(() => { if (!injected) inject(); });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => obs.disconnect(), 60000);
        schedule();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    console.log('[DS Pricing] v3.7');
})();
