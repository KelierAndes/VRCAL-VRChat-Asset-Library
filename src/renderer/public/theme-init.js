// Classic parser-blocking bootstrap: preload is available before renderer code.
// Keep this independent of React and its deferred module graph.
(() => {
  const language = window.library?.initialLanguage;
  document.documentElement.lang = ['zh-CN','ja','en'].includes(language) ? language : 'zh-CN';
  const requested = window.library?.initialTheme;
  document.documentElement.dataset.theme =
    requested === 'x-light' || requested === 'x' || requested === 'swiss' || requested === 'nasa'
      ? requested
      : 'nasa';
})();
