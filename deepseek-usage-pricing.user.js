// ==UserScript==
// @name         DeepSeek 用量计费明细
// @namespace    https://platform.deepseek.com/usage
// @version      4.0
// @description  在用量卡片上方插入费用和 Token 明细横幅（支持峰谷定价）
// @author       Reasonix
// @match        https://platform.deepseek.com/usage*
// @icon         https://platform.deepseek.com/favicon.ico
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /* ========================================================
       定价 (人民币 ¥ / 百万 tokens)
       峰谷时段：每日北京时间 9:00-12:00, 14:00-18:00 为高峰
       ======================================================== */
    const PRICING = {
        'deepseek-v4-flash': {
            cacheHit:  { normal: 0.02,  peak: 0.04 },
            cacheMiss: { normal: 1.00,  peak: 2.00 },
            output:    { normal: 2.00,  peak: 4.00 },
        },
        'deepseek-v4-pro': {
            cacheHit:  { normal: 0.025, peak: 0.05 },
            cacheMiss: { normal: 3.00,  peak: 6.00 },
            output:    { normal: 6.00,  peak: 12.00 },
        },
    };

    function getPrice(n) {
        n = (n || '').toLowerCase();
        if (PRICING[n]) return PRICING[n];
        if (/flash|chat|reasoner/.test(n)) return PRICING['deepseek-v4-flash'];
        if (/pro/.test(n)) return PRICING['deepseek-v4-pro'];
        return null;
    }

    // 判断是否高峰时段（北京时间 UTC+8）
    function isPeak(unixSec) {
        const h = (new Date(unixSec * 1000).getUTCHours() + 8) % 24;
        return (h >= 9 && h < 12) || (h >= 14 && h < 18);
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
       解析 — 按 bucket 粒度区分峰谷
       ======================================================== */
    function sv(v) {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? Math.max(n, 0) : 0;
    }

    function parseTokens() {
        if (!_amt) return null;
        const body = _amt?.data?.biz_data;
        if (!body) return null;

        let model = 'deepseek-v4-flash';
        // 累计峰/谷 token 数
        let peakHit = 0, peakMiss = 0, peakOut = 0;
        let normHit = 0, normMiss = 0, normOut = 0;

        if (body.series) {
            for (const s of body.series) {
                model = s.model || model;
                for (const b of (s.buckets || [])) {
                    const peak = isPeak(b.time);
                    const u = b.usage || {};
                    if (peak) {
                        peakHit  += sv(u.PROMPT_CACHE_HIT_TOKEN);
                        peakMiss += sv(u.PROMPT_CACHE_MISS_TOKEN);
                        peakOut  += sv(u.RESPONSE_TOKEN);
                    } else {
                        normHit  += sv(u.PROMPT_CACHE_HIT_TOKEN);
                        normMiss += sv(u.PROMPT_CACHE_MISS_TOKEN);
                        normOut  += sv(u.RESPONSE_TOKEN);
                    }
                }
            }
        } else if (Array.isArray(body) && body[0]?.total) {
            for (const m of body[0].total) {
                if (m.usage?.some(u => sv(u.amount) > 0)) model = m.model || model;
                // 旧格式无时间戳，全部按 normal 计
                for (const u of (m.usage || [])) {
                    const v = sv(u.amount) * 1_000_000;
                    if (u.type === 'PROMPT_CACHE_HIT_TOKEN')  normHit  += v;
                    if (u.type === 'PROMPT_CACHE_MISS_TOKEN') normMiss += v;
                    if (u.type === 'RESPONSE_TOKEN')          normOut  += v;
                }
            }
        }

        const totalHit = peakHit + normHit;
        const totalMiss = peakMiss + normMiss;
        const totalOut = peakOut + normOut;
        if (totalHit + totalMiss + totalOut === 0) return null;

        return {
            model,
            peak:  { cacheHit: peakHit,  cacheMiss: peakMiss, output: peakOut },
            norm:  { cacheHit: normHit,  cacheMiss: normMiss, output: normOut },
            total: { cacheHit: totalHit, cacheMiss: totalMiss, output: totalOut },
        };
    }

    /* ========================================================
       注入
       ======================================================== */
    let injected = false;

    function inject() {
        if (injected) return;

        const t = parseTokens();
        if (!t) return;

        const price = getPrice(t.model);
        if (!price) return;

        // 峰谷费用计算
        const peakFee = (t.peak.cacheHit / 1e6) * price.cacheHit.peak
                      + (t.peak.cacheMiss / 1e6) * price.cacheMiss.peak
                      + (t.peak.output / 1e6) * price.output.peak;
        const normFee = (t.norm.cacheHit / 1e6) * price.cacheHit.normal
                      + (t.norm.cacheMiss / 1e6) * price.cacheMiss.normal
                      + (t.norm.output / 1e6) * price.output.normal;
        const totalFee = peakFee + normFee;

        // 分项费用（用 normal 价格算基准，峰谷分开显示）
        const chFee = (t.norm.cacheHit / 1e6) * price.cacheHit.normal
                    + (t.peak.cacheHit / 1e6) * price.cacheHit.peak;
        const cmFee = (t.norm.cacheMiss / 1e6) * price.cacheMiss.normal
                    + (t.peak.cacheMiss / 1e6) * price.cacheMiss.peak;
        const oFee  = (t.norm.output / 1e6) * price.output.normal
                    + (t.peak.output / 1e6) * price.output.peak;

        const totalInput = t.total.cacheHit + t.total.cacheMiss;
        const cacheRate = totalInput > 0 ? ((t.total.cacheHit / totalInput) * 100).toFixed(1) : '0';

        // 找 grid
        let grid = null;
        const all = document.querySelectorAll('*');
        for (const el of all) {
            const ch = el.children;
            if (ch.length >= 3) {
                let hasC = false, hasT = false;
                for (const c of ch) {
                    const txt = c.textContent?.trim() || '';
                    if (txt.startsWith('消费金额')) hasC = true;
                    if (txt.startsWith('Tokens') && !txt.includes('100,000')) hasT = true;
                }
                if (hasC && hasT) { grid = el; break; }
            }
        }

        if (!grid) return;
        if (document.querySelector('#ds-pricing-banner')) { injected = true; return; }

        const brand = 'var(--dsw-alias-brand-primary, #3964fe)';
        const primary = 'var(--dsw-alias-label-primary, #000)';

        const banner = document.createElement('div');
        banner.id = 'ds-pricing-banner';
        banner.style.cssText = `display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px;padding:16px 20px;border-radius:12px;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,0.04));font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,#6a7a9a);`;

        // 峰谷标签
        const peakTag = peakFee > 0
            ? `<span style="display:inline-block;font-size:10px;padding:1px 6px;border-radius:4px;background:#fff3e0;color:#e65100;margin-left:4px;">峰</span>`
            : '';

        banner.innerHTML = `
            <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;flex:1;min-width:240px;">
                <span style="font-weight:600;color:${brand};white-space:nowrap;font-size:14px;">💰 费用明细</span>
                <span><span style="color:#22c55e;">缓存命中</span> <b style="color:${primary};">${fmt(chFee)}</b></span>
                <span><span style="color:#f59e0b;">未命中</span> <b style="color:${primary};">${fmt(cmFee)}</b></span>
                <span><span style="color:#3b82f6;">输出</span> <b style="color:${primary};">${fmt(oFee)}</b></span>
                <span style="border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,0.1));padding-left:12px;">
                    <b style="color:${primary};">合计 ${fmt(totalFee)}</b>${peakTag}
                </span>
                ${peakFee > 0 ? `<span style="font-size:11px;color:#e65100;">(高峰 ${fmt(peakFee)} / 平时 ${fmt(normFee)})</span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;flex:1;min-width:240px;border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,0.08));padding-left:20px;">
                <span style="font-weight:600;color:${brand};white-space:nowrap;font-size:14px;">📊 Token 明细</span>
                <span>输入 <b style="color:${primary};">${fmtTk(totalInput)}</b> (命中 ${fmtTk(t.total.cacheHit)} / 未命中 ${fmtTk(t.total.cacheMiss)})</span>
                <span>输出 <b style="color:${primary};">${fmtTk(t.total.output)}</b></span>
                <span>缓存率 <b style="color:${brand};">${cacheRate}%</b></span>
            </div>
        `;

        grid.parentElement?.insertBefore(banner, grid);
        injected = true;
        console.log('[DS] ✅', fmt(totalFee), `(${peakFee > 0 ? '峰' + fmt(peakFee) + '+' : ''}谷${fmt(normFee)})`, '输入', fmtTk(totalInput), cacheRate + '%');
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

    console.log('[DS Pricing] v4.0 (峰谷定价)');
})();
