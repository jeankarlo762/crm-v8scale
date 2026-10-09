// Aplica o tema antes do primeiro paint (sem flash). Mesma lógica de src/store/ui.store.ts.
// Fica em arquivo separado (e não inline) para a Content-Security-Policy permitir só scripts do próprio build.
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t !== 'light' && t !== 'dark' && t !== 'system') t = 'system';
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var el = document.documentElement;
    if (dark) el.classList.add('dark');
    el.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
