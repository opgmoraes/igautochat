(function () {
  const SUPABASE_JS_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Inicializa o cliente Supabase no navegador (usa a chave pública, não a secreta)
  window.initAuth = async function () {
    if (window.sb) return window.sb;
    await loadScript(SUPABASE_JS_CDN);
    const cfgRes = await fetch("/api/public-config");
    const cfg = await cfgRes.json();
    window.sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return window.sb;
  };

  // Chama isso no topo de qualquer página protegida: manda pro login se não estiver logado
  window.requireAuth = async function () {
    const sb = await window.initAuth();
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session) {
      window.location.href = "/login.html";
      return null;
    }
    return session;
  };

  // Fetch que já manda o token de login junto (usa isso em vez de fetch() puro
  // pra chamar qualquer rota protegida, tipo /api/automations)
  window.authFetch = async function (url, opts) {
    opts = opts || {};
    const sb = await window.initAuth();
    const {
      data: { session },
    } = await sb.auth.getSession();
    opts.headers = Object.assign({}, opts.headers, {
      Authorization: "Bearer " + (session ? session.access_token : ""),
    });
    return fetch(url, opts);
  };
})();
