/* Cliente HTTP del API MV4 (Apps Script doPost).
   POST con Content-Type text/plain = "simple request": sin preflight CORS. */
const API = (() => {

  async function post(body, timeoutMs = 45000) {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(MV4_CONFIG.API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        redirect: "follow"
      });
      const data = await r.json();
      // Sesión vencida en cualquier llamada → regresar al login
      if (data && data.ok === false && /sesi[oó]n inv[aá]lida|expirad/i.test(data.mensaje || "")) {
        Session.clear();
        App.irLogin("Tu sesión expiró. Vuelve a entrar.");
      }
      return data;
    } catch (e) {
      if (e.name === "AbortError") return { ok: false, mensaje: "El servidor tardó demasiado. Intenta de nuevo.", _timeout: true };
      return { ok: false, mensaje: "Sin conexión. Revisa tu internet e intenta de nuevo.", _red: true };
    } finally {
      clearTimeout(tm);
    }
  }

  return {
    login:           (usuario, password) => post({ action: "autenticarCliente", usuario, password }),
    logout:          (token)             => post({ action: "cerrarSesionCliente", token }),
    catalogo:        (token)             => post({ token, action: "obtenerCatalogoPortal" }, 90000),
    ofertas:         (token)             => post({ token, action: "obtenerOfertasPortal" }),
    banners:         (token)             => post({ token, action: "obtenerBannersPortal" }, 90000),
    misPedidos:      (token)             => post({ token, action: "obtenerPedidosCliente" }),
    detallePedido:   (token, noPedido)   => post({ token, action: "obtenerDetallePedidoCliente", noPedido }),
    registrarPedido: (pedidoData)        => post({ action: "registrarPedidoCliente", pedidoData }, 90000),
    guardarLista:    (token, nombreLista, items) => post({ token, action: "guardarListaCliente", nombreLista, items }),
    misListas:       (token)             => post({ token, action: "obtenerListasCliente" })
  };
})();

/* Sesión persistente (localStorage, el backend expira a las 8 h) */
const Session = {
  KEY: "mv4p2_sesion",
  get() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || null; } catch (e) { return null; }
  },
  set(token, cliente) {
    localStorage.setItem(this.KEY, JSON.stringify({ token, cliente, ts: Date.now() }));
  },
  clear() { localStorage.removeItem(this.KEY); }
};
