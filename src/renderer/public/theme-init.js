// Classic parser-blocking bootstrap: preload is available before renderer code.
// Keep this independent of React and its deferred module graph.
(() => {
  const requested = window.library?.initialTheme;
  document.documentElement.dataset.theme =
    requested === 'x' || requested === 'swiss' || requested === 'nasa'
      ? requested
      : 'nasa';
})();
