(() => {
  'use strict';

  // AtlasCloud current Seedream v5.0 Pro pricing (checked 2026-09-28):
  // <= 2.36M px: $0.045 -> $0.036 (-20%)
  // > 2.36M px:  $0.090 -> $0.072 (-20%)
  // First input image is free; each additional input image adds $0.003.
  const PRICING = {
    '1.5K': { list: 0.045, promo: 0.036 },
    '2K': { list: 0.090, promo: 0.072 },
    extraInput: 0.003,
    discountLabel: '-20%'
  };

  const $ = (selector) => document.querySelector(selector);
  let scheduled = false;

  function money(value) {
    return Number(value).toFixed(3);
  }

  function getInputCount() {
    const text = $('#inputImageCount')?.textContent || '';
    const match = text.match(/(\d+)\s*\/\s*10/);
    return match ? Number(match[1]) : 0;
  }

  function getTier(detailsText) {
    return detailsText.includes('2K计费档') ? '2K' : '1.5K';
  }

  function getSizeText(detailsText) {
    const match = detailsText.match(/^\s*([\d]+\s*×\s*[\d]+)/);
    return match ? match[1].replace(/\s+/g, ' ') : '';
  }

  function applyCurrentAtlasPrice() {
    scheduled = false;
    const estimate = $('#costEstimate');
    const details = $('#costDetails');
    const countSelect = $('#outputCount');
    if (!estimate || !details || !countSelect) return;

    const currentDetails = details.textContent || '';
    const tier = getTier(currentDetails);
    const size = getSizeText(currentDetails);
    const count = Math.max(1, Math.min(4, Number(countSelect.value) || 1));
    const inputCount = getInputCount();
    const extra = Math.max(0, inputCount - 1) * PRICING.extraInput;
    const tierPrice = PRICING[tier];
    const unit = tierPrice.promo + extra;
    const total = unit * count;

    const nextEstimate = `预计 $${money(total)} / ${count} 张`;
    let nextDetails = `${size ? size + ' · ' : ''}${tier}计费档 · AtlasCloud 优惠价单张 $${money(unit)}`;
    if (extra > 0) nextDetails += `（基础 $${money(tierPrice.promo)} + 额外输入图 $${money(extra)}）`;
    nextDetails += ` · 原价 $${money(tierPrice.list)} → $${money(tierPrice.promo)}（${PRICING.discountLabel}）`;

    if (estimate.textContent !== nextEstimate) estimate.textContent = nextEstimate;
    if (details.textContent !== nextDetails) details.textContent = nextDetails;

    const note = estimate.closest('.cost-box')?.querySelector('small');
    if (note) {
      note.textContent = '已按 AtlasCloud 当前优惠价估算；额外输入图从第 2 张起仍按 $0.003/张计。实际扣费以 AtlasCloud 账单为准。';
    }
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(applyCurrentAtlasPrice);
  }

  function init() {
    const estimate = $('#costEstimate');
    const details = $('#costDetails');
    if (!estimate || !details) return;

    const observer = new MutationObserver(scheduleApply);
    observer.observe(estimate, { childList: true, characterData: true, subtree: true });
    observer.observe(details, { childList: true, characterData: true, subtree: true });

    ['outputCount', 'inputImageCount', 'ratioGrid'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    });

    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-resolution], [data-ratio], .input-image-item')) scheduleApply();
    });
    document.addEventListener('change', scheduleApply, true);

    applyCurrentAtlasPrice();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();