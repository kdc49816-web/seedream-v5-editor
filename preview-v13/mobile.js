(() => {
  const viewport=window.visualViewport;
  const resize=()=>{document.documentElement.style.setProperty('--app-height',`${Math.round(viewport?.height||innerHeight)}px`);window.scrollTo(0,0)};
  resize();viewport?.addEventListener('resize',resize);window.addEventListener('resize',resize);
  document.addEventListener('focusin',e=>{if(e.target.matches('input,textarea,select'))setTimeout(()=>e.target.scrollIntoView({block:'nearest'}),250)});
  document.addEventListener('focusout',()=>setTimeout(resize,100));
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
