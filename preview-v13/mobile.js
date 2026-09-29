(() => {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const isFormControlFocused = () => document.activeElement?.matches?.('input,textarea,select');

  const applyHeight = () => {
    const inner = window.innerHeight || root.clientHeight || 0;
    const visual = viewport?.height || inner;
    const keyboardOpen = !!isFormControlFocused() && inner - visual > 120;
    root.style.setProperty('--app-height', keyboardOpen ? `${Math.round(visual)}px` : '100dvh');
    if (!keyboardOpen) window.scrollTo(0, 0);
  };

  const style = document.createElement('style');
  style.id = 'studio-mobile-fix-v33';
  style.textContent = `
    html,body{height:100dvh!important;min-height:100dvh!important;background:#090a0b!important}
    .app-shell{height:var(--app-height,100dvh)!important;min-height:var(--app-height,100dvh)!important}
    @media(max-width:720px){
      main{padding-bottom:12px!important}
      .tabs{margin-bottom:0!important}
      #albumStackView:has(#albumStackDeck > .empty-state) .stack-topline,
      #albumStackView:has(#albumStackDeck > .empty-state) .stack-nav{display:none!important}
      #albumStackView .stack-viewport:has(#albumStackDeck > .empty-state){height:168px!important;min-height:168px!important;max-height:168px!important}
      #albumStackDeck > .empty-state{height:100%!important;min-height:0!important;border:0!important;border-radius:16px!important;background:#101213!important}
    }
  `;
  document.head.appendChild(style);

  applyHeight();
  viewport?.addEventListener('resize', applyHeight);
  viewport?.addEventListener('scroll', applyHeight);
  window.addEventListener('resize', applyHeight);
  window.addEventListener('orientationchange', () => setTimeout(applyHeight, 180));
  document.addEventListener('focusin', e => {
    if (e.target.matches('input,textarea,select')) {
      setTimeout(() => {
        applyHeight();
        e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 220);
    }
  });
  document.addEventListener('focusout', () => setTimeout(applyHeight, 140));
  window.addEventListener('pageshow', applyHeight);

  // GitHub Pages is static. The account backend lives on the published cloud app.
  // Use the live root URL instead of the old /studio/?import=1 route that can be blocked.
  if (location.hostname.endsWith('github.io')) {
    const accountBtn = document.querySelector('#accountBtn');
    accountBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const cloudUrl = 'https://seedream-v5-editor.kdc425.chatgpt.site/';
      const popup = window.open(cloudUrl, 'seedream-cloud');
      if (!popup) {
        const toast = window.seedream?.toast;
        if (toast) toast('请允许打开登录窗口');
        else location.assign(cloudUrl);
      }
    }, true);
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=33').catch(() => {});
})();
