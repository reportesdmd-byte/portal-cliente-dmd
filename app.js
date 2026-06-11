/* ════════════════════════════════════════════════════════════
   DMD Portal Cliente 2.0 — lógica de la aplicación
════════════════════════════════════════════════════════════ */
const App = (() => {

  /* ── Estado ── */
  let SESION = null;          // { token, cliente }
  let CATALOGO = [];          // items de obtenerCatalogoPortal
  let CAT_TS = 0;             // timestamp del catálogo en memoria
  let CART = {};              // { codigo: cantidad }
  let FILTRO = { grupo: "", texto: "", soloStock: false, soloOfertas: false };
  let PAGINA = 1;             // paginación del grid (60 por página)
  const PAGE_SIZE = 60;
  let QO_OK = [];             // renglones válidos del pedido rápido
  let ULTIMO_PEDIDO = null;   // para "re-pedir lo de siempre"
  let PEDIDOS_CACHE = [];

  /* ── Utilidades ── */
  const $ = id => document.getElementById(id);
  const money = n => "$" + (+n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = s => (s == null ? "" : String(s)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // Nombres estilo SAIT ("A S COR|GOT|24ML") → presentación legible para el cliente
  const fmt = s => esc(s).replace(/\s*\|\s*/g, " · ");
  const norm = s => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const precioEf = p => (p.oferta && p.precioOferta > 0 && p.precioOferta < p.precio) ? p.precioOferta : p.precio;
  function gana(p) {
    const pub = p.precioPublico || 0, mio = precioEf(p);
    return (pub > mio && mio > 0) ? Math.round((pub - mio) / pub * 100) : 0;
  }
  const packHTML = forma => `<div class="pack"><div class="pack-${["caja","frasco","bote","tubo"].includes(forma) ? forma : "caja"}"></div></div>`;
  function toast(msg, ms = 2400) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove("show"), ms);
  }
  const byCod = cod => CATALOGO.find(p => p.codigo === cod);
  const cartKey = () => "mv4p2_cart_" + (SESION?.cliente?.idCliente || "anon");
  const catKey  = () => "mv4p2_cat_"  + (SESION?.cliente?.idCliente || "anon");
  const manana = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

  /* ── Navegación ── */
  function go(screen) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("on"));
    $("s-" + screen).classList.add("on");
    document.querySelectorAll(".bnav button").forEach(b => b.classList.remove("on"));
    const bn = $("bn-" + screen); if (bn) bn.classList.add("on");
    document.querySelectorAll(".catnav .cat").forEach(b => b.classList.remove("on"));
    if (screen === "home") document.querySelector('.catnav .cat[data-go="home"]')?.classList.add("on");
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (screen === "carrito") renderCarrito();
    if (screen === "catalogo") renderCatalogo();
    if (screen === "pedidos") cargarPedidos();
  }

  function irCatalogo({ grupo = "", texto = null, soloOfertas = false } = {}) {
    FILTRO.grupo = grupo; FILTRO.soloOfertas = soloOfertas; PAGINA = 1;
    if (texto !== null) { FILTRO.texto = texto; $("buscar").value = texto; }
    go("catalogo");
  }

  /* ── Login / sesión ── */
  function setMsg(html, tipo) {
    $("login-msg").innerHTML = html ? `<div class="msg msg-${tipo}">${html}</div>` : "";
  }

  async function doLogin() {
    const usr = $("login-usr").value.trim(), pwd = $("login-pwd").value;
    if (!usr || !pwd) { setMsg("Ingresa usuario y contraseña.", "error"); return; }
    const btn = $("login-btn");
    btn.disabled = true; btn.textContent = "Verificando…"; setMsg("");
    const res = await API.login(usr, pwd);
    btn.disabled = false; btn.textContent = "Entrar";
    if (!res.ok) { setMsg(esc(res.mensaje || "No se pudo iniciar sesión."), "error"); return; }
    Session.set(res.token, res.cliente);
    SESION = { token: res.token, cliente: res.cliente };
    entrar();
  }

  function irLogin(aviso) {
    SESION = null;
    $("vista-app").hidden = true;
    $("vista-login").hidden = false;
    $("login-pwd").value = "";
    if (aviso) setMsg(esc(aviso), "error");
  }

  async function doLogout() {
    if (!confirm("¿Cerrar sesión?")) return;
    try { API.logout(SESION.token); } catch (e) {}
    Session.clear();
    irLogin();
  }

  /* ── Arranque post-login ── */
  function entrar() {
    $("vista-login").hidden = true;
    $("vista-app").hidden = false;
    const c = SESION.cliente;
    $("cinta-nombre").textContent = c.empresa || c.nombre || "";
    $("cinta-id").textContent = c.idCliente || "";
    $("cinta-lista").textContent = "Lista " + (c.listaAsignada || "1");
    $("cinta-amb").hidden = MV4_CONFIG.AMBIENTE !== "DEV";
    $("pie").textContent = `Portal Cliente DMD ${MV4_CONFIG.VERSION} · ${MV4_CONFIG.AMBIENTE}`;
    CART = JSON.parse(localStorage.getItem(cartKey()) || "{}");
    syncBadge();
    go("home");
    cargarCatalogo();
    precargarPedidos();
    cargarBanners();
  }

  /* ── Catálogo (cache local + refresco) ── */
  async function cargarCatalogo(forzar) {
    // 1. intenta cache local
    if (!forzar) {
      try {
        const c = JSON.parse(localStorage.getItem(catKey()) || "null");
        if (c && Date.now() - c.ts < MV4_CONFIG.CACHE_CATALOGO_MIN * 60000 && c.items?.length) {
          CATALOGO = c.items; CAT_TS = c.ts;
          renderHome(); return;
        }
      } catch (e) {}
    }
    // 2. al servidor
    const res = await API.catalogo(SESION.token);
    if (!res.ok) {
      $("carril-ofertas").innerHTML = `<div class="msg msg-error">${esc(res.mensaje)}</div>`;
      return;
    }
    CATALOGO = (res.items || []).filter(p => (+p.precio) > 0);
    CAT_TS = Date.now();
    try { localStorage.setItem(catKey(), JSON.stringify({ ts: CAT_TS, items: CATALOGO })); }
    catch (e) { /* localStorage lleno: seguimos solo en memoria */ }
    renderHome();
    if ($("s-catalogo").classList.contains("on")) renderCatalogo();
  }

  /* ── Tarjeta de producto ── */
  function cardHTML(p) {
    const qty = CART[p.codigo] || 0;
    const sin = p.stock !== null ? p.stock <= 0 : !p.disponible;
    const pct = gana(p);
    const ef = precioEf(p);
    const tach = p.oferta && ef < p.precio ? p.precio : (p.precioPublico > ef ? p.precioPublico : 0);
    const stockTxt = p.stock !== null
      ? (sin ? "✗ Sin existencia" : `✓ ${p.stock} disponibles`)
      : (sin ? "✗ Sin existencia" : "✓ Disponible");
    return `<div class="pcard" data-card="${esc(p.codigo)}">
      ${p.oferta ? '<span class="oferta-tag">OFERTA</span>' : ""}
      <div class="img" data-ficha="${esc(p.codigo)}">${packHTML(p.forma)}</div>
      <span class="cod">${esc(p.codPropio ? p.codPropio + " · " : "")}${esc(p.codigo)}</span>
      <span class="nom" data-ficha="${esc(p.codigo)}">${fmt(p.descripcion || p.nombre)}</span>
      <div class="precios">
        ${tach ? `<span class="pub">${p.oferta ? "Antes" : "Público"} ${money(tach)}</span>` : ""}
        <span class="mio ${p.oferta ? "of" : ""}">${money(ef)}</span>
      </div>
      ${pct ? `<span class="gana">Ganas ${pct}%</span>` : ""}
      <div class="pcard-foot">
        <span class="stock-chip ${sin ? "no" : "si"}">${stockTxt}</span>
        ${sin ? '<button class="add" disabled>+</button>'
              : qty > 0 ? stepperHTML(p.codigo, qty)
                        : `<button class="add" data-add="${esc(p.codigo)}">+</button>`}
      </div>
    </div>`;
  }
  const stepperHTML = (cod, qty) =>
    `<div class="stepper"><button data-delta="${esc(cod)},-1">−</button><b>${qty}</b><button data-delta="${esc(cod)},1">+</button></div>`;

  /* ── Home ── */
  function renderHome() {
    const ofertas = CATALOGO.filter(p => p.oferta);
    const top = CATALOGO.filter(p => (p.stock === null ? p.disponible : p.stock > 0)).slice(0, 8);
    $("carril-ofertas").innerHTML = ofertas.length
      ? ofertas.slice(0, 8).map(cardHTML).join("")
      : '<div class="msg msg-ok">Pronto verás aquí las ofertas del mes.</div>';
    $("carril-top").innerHTML = top.map(cardHTML).join("");
    $("destacado-sub").textContent = CATALOGO.length.toLocaleString() + " productos en tu catálogo";
    const dest = ofertas.filter(p => p.ofertaDestacada)[0];
    $("ofertas-strip").innerHTML = `
      <div class="oferta-card of-1" data-grupo="__ofertas">
        <span class="pct">${ofertas.length}</span><b>Ofertas vigentes</b>
        <span>${dest ? "Destacada: " + fmt((dest.descripcion || dest.nombre).slice(0, 38)) : "Consulta el catálogo"}</span>
      </div>
      <div class="oferta-card of-2" data-go="carrito">
        <span class="pct">${MV4_CONFIG.PCT_DESC_VOLUMEN}%</span><b>Descuento por volumen</b>
        <span>En pedidos mayores a ${money(MV4_CONFIG.UMBRAL_DESC_VOLUMEN)} — se aplica en facturación</span>
      </div>
      <div class="oferta-card of-3" data-go="quick">
        <span class="pct">⚡</span><b>Pedido rápido</b>
        <span>Pega tu lista de códigos y listo</span>
      </div>`;
  }

  async function cargarBanners() {
    const res = await API.banners(SESION.token);
    const list = res.banners || [];
    if (!list.length) return;
    $("banners").innerHTML = list.map(b => `<img src="${b.urlImagen}" alt="${esc(b.textoAlt)}" loading="lazy">`).join("");
    $("banners").hidden = false;
  }

  /* ── Catálogo (grid) ── */
  function itemsFiltrados() {
    let items = CATALOGO;
    if (FILTRO.grupo) items = items.filter(p => (p.grupo || "") === FILTRO.grupo);
    if (FILTRO.soloOfertas) items = items.filter(p => p.oferta);
    if (FILTRO.soloStock) items = items.filter(p => (p.stock === null ? p.disponible : p.stock > 0));
    if (FILTRO.texto) {
      const t = norm(FILTRO.texto);
      items = items.filter(p => norm(p.nombre + " " + p.codigo + " " + (p.codPropio || "") + " " + (p.descripcion || "")).includes(t));
    }
    return items;
  }

  function renderCatalogo() {
    if (!CATALOGO.length) {
      $("grid-cat").innerHTML = '<div class="cargando"><div class="spinner"></div>Cargando catálogo…</div>';
      return;
    }
    // filtros de grupo dinámicos
    const grupos = [...new Set(CATALOGO.map(p => p.grupo).filter(Boolean))].sort();
    $("f-grupos").innerHTML =
      `<label><input type="radio" name="fg" ${!FILTRO.grupo ? "checked" : ""} data-fgrupo=""> Todos</label>` +
      grupos.map(g => `<label><input type="radio" name="fg" ${FILTRO.grupo === g ? "checked" : ""} data-fgrupo="${esc(g)}"> ${esc(g)}</label>`).join("");

    const items = itemsFiltrados();
    const visibles = items.slice(0, PAGINA * PAGE_SIZE);
    $("cat-titulo").textContent = FILTRO.texto ? `Resultados para “${FILTRO.texto}”`
                                : FILTRO.soloOfertas ? "Ofertas del mes"
                                : (FILTRO.grupo || "Catálogo");
    $("cat-conteo").textContent = items.length.toLocaleString() + " productos · búsqueda instantánea";
    $("grid-cat").innerHTML = visibles.length ? visibles.map(cardHTML).join("")
      : '<div class="vacio">Sin resultados. Prueba con otro término o con tu código propio.</div>';
    $("btn-mas").hidden = visibles.length >= items.length;
  }

  /* ── Ficha ── */
  function ficha(cod) {
    const p = byCod(cod); if (!p) return;
    const sin = p.stock !== null ? p.stock <= 0 : !p.disponible;
    const ef = precioEf(p), pct = gana(p);
    $("s-ficha").innerHTML = `
    <div class="ficha">
      <div class="ficha-img">${packHTML(p.forma)}</div>
      <div class="ficha-info">
        <div class="ruta">Catálogo / <b>${esc(p.grupo || "General")}</b></div>
        <h1>${fmt(p.nombre)}</h1>
        <div class="sku">Código ${esc(p.codigo)}${p.codPropio ? " · Tu código: " + esc(p.codPropio) : ""} · Pieza</div>
        <div class="chips">
          ${sin ? '<span class="chip chip-gris">Sin existencia</span>'
                : '<span class="chip chip-verde">🚚 Pide hoy, va en la siguiente ruta</span>'}
          ${p.oferta ? `<span class="chip chip-oro">🏷 Oferta${p.ofertaVigencia ? " · vence " + esc(p.ofertaVigencia) : ""}</span>` : ""}
          <span class="chip chip-oro">${esc(p.lista || "")} · tu precio asignado</span>
        </div>
        <div class="caja-precio">
          ${p.precioPublico > ef ? `<div class="linea-p"><span>Precio público sugerido</span><b class="tach">${money(p.precioPublico)}</b></div>` : ""}
          ${p.oferta && ef < p.precio ? `<div class="linea-p"><span>Tu precio normal</span><b class="tach">${money(p.precio)}</b></div>` : ""}
          <div class="tuyo"><span style="font-weight:700">Pagas</span><span class="monto">${money(ef)}</span></div>
          ${pct ? `<div class="gana-grande">💰 En este producto tu farmacia gana <b>un ${pct}%</b> sobre precio público</div>` : ""}
        </div>
        <div class="compra-row">
          <div class="stepper"><button id="f-menos">−</button><b id="f-qty">${CART[cod] || 1}</b><button id="f-mas">+</button></div>
          <button class="btn btn-bosque" id="f-add" ${sin ? "disabled" : ""}>Agregar al carrito</button>
        </div>
      </div>
    </div>`;
    $("f-menos").onclick = () => { const e = $("f-qty"); e.textContent = Math.max(1, +e.textContent - 1); };
    $("f-mas").onclick  = () => { const e = $("f-qty"); e.textContent = +e.textContent + 1; };
    $("f-add").onclick  = () => {
      CART[cod] = (CART[cod] || 0) + (+$("f-qty").textContent);
      persistCart(); toast("Agregado al carrito ✓");
    };
    go("ficha");
  }

  /* ── Carrito ── */
  function persistCart() {
    localStorage.setItem(cartKey(), JSON.stringify(CART));
    syncBadge();
  }
  function add(cod) { CART[cod] = 1; persistCart(); refrescaPantalla(); toast("Agregado al carrito ✓"); }
  function delta(cod, d) {
    CART[cod] = (CART[cod] || 0) + d;
    if (CART[cod] <= 0) delete CART[cod];
    persistCart(); refrescaPantalla();
  }
  function refrescaPantalla() {
    if ($("s-home").classList.contains("on")) renderHome();
    if ($("s-catalogo").classList.contains("on")) renderCatalogo();
    if ($("s-carrito").classList.contains("on")) renderCarrito();
  }
  function syncBadge() {
    const n = Object.values(CART).reduce((s, q) => s + q, 0);
    ["badge-d", "badge-m"].forEach(id => {
      const b = $(id); b.hidden = n <= 0; b.textContent = n > 99 ? "99+" : n;
    });
  }

  function renderCarrito() {
    const entries = Object.entries(CART).filter(([cod]) => byCod(cod));
    if (!entries.length) {
      $("s-carrito").innerHTML = `<div class="vacio">
        ${packHTML("caja")}
        <h2 class="sec" style="justify-content:center">Tu carrito está vacío</h2>
        <p style="margin-bottom:20px">Los productos que agregues se guardan aunque cierres la app.</p>
        <button class="btn btn-bosque" data-grupo="">Ir al catálogo</button></div>`;
      return;
    }
    let piezas = 0, importe = 0;
    const items = entries.map(([cod, qty]) => {
      const p = byCod(cod), ef = precioEf(p), pct = gana(p);
      piezas += qty; importe += ef * qty;
      return `<div class="car-item">
        <div class="mini">${packHTML(p.forma)}</div>
        <div class="dat">
          <b>${fmt(p.descripcion || p.nombre)}</b>
          <span>${money(ef)} c/u${p.oferta ? ' · <span style="color:var(--rojo);font-weight:700">OFERTA</span>' : ""}${pct ? ` · <span style="color:var(--ok)">ganas ${pct}%</span>` : ""}</span><br>
          <button class="quitar" data-delta="${esc(cod)},-${qty}">Quitar</button>
        </div>
        ${stepperHTML(cod, qty)}
        <div class="sub">${money(ef * qty)}</div>
      </div>`;
    }).join("");
    const aplicaDesc = importe > MV4_CONFIG.UMBRAL_DESC_VOLUMEN;
    const desc = aplicaDesc ? importe * MV4_CONFIG.PCT_DESC_VOLUMEN / 100 : 0;
    $("s-carrito").innerHTML = `
    <h2 class="sec">Tu carrito <small>${entries.length} productos · se guarda automáticamente</small></h2>
    <div class="car-layout">
      <div>${items}
        <button class="btn btn-linea btn-sm" id="btn-guardar-lista" style="margin-top:6px">💾 Guardar carrito como lista</button>
      </div>
      <div class="panel resumen">
        <h3>Resumen del pedido</h3>
        <div class="res-row"><span>Artículos distintos</span><b>${entries.length}</b></div>
        <div class="res-row"><span>Total de piezas</span><b>${piezas}</b></div>
        <div class="res-row"><span>Subtotal</span><b>${money(importe)}</b></div>
        ${aplicaDesc
          ? `<div class="res-row desc"><span>Desc. por volumen (${MV4_CONFIG.PCT_DESC_VOLUMEN}%) en facturación</span><b>−${money(desc)}</b></div>`
          : `<div class="aviso-desc">💡 Te faltan ${money(Math.max(0, MV4_CONFIG.UMBRAL_DESC_VOLUMEN - importe))} para el ${MV4_CONFIG.PCT_DESC_VOLUMEN}% de descuento por volumen</div>`}
        <div class="res-row total"><span>Total del pedido</span><span class="monto">${money(importe)}</span></div>
        <div class="res-meta">
          <label>Fecha de entrega deseada (opcional)</label>
          <input type="date" id="car-fecha" min="${manana()}">
          <label>Observaciones</label>
          <textarea id="car-obs" rows="2" placeholder="Notas para el repartidor o tu asesor…"></textarea>
        </div>
        <button class="btn btn-oro btn-block" id="btn-confirmar">Confirmar pedido</button>
        <div id="car-msg" style="margin-top:10px"></div>
      </div>
    </div>`;
    $("btn-confirmar").onclick = confirmarPedido;
    $("btn-guardar-lista").onclick = guardarComoLista;
  }

  async function confirmarPedido() {
    const items = Object.entries(CART).map(([codigo, cantidad]) => ({ codigo, cantidad }));
    if (!items.length) return;
    const btn = $("btn-confirmar");
    btn.disabled = true; btn.textContent = "Enviando pedido…";
    $("car-msg").innerHTML = "";
    const res = await API.registrarPedido({
      token: SESION.token,
      items,
      fechaEntrega: $("car-fecha").value || null,
      observaciones: $("car-obs").value.trim()
    });
    btn.disabled = false; btn.textContent = "Confirmar pedido";
    if (!res.ok) {
      $("car-msg").innerHTML = `<div class="msg msg-error">${esc(res.mensaje)}</div>`;
      return;
    }
    CART = {}; persistCart();
    PEDIDOS_CACHE = [];
    $("s-exito").innerHTML = `
    <div class="exito">
      <div class="check"><svg fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></div>
      <h2>¡Pedido recibido!</h2>
      <div class="folio-big">${esc(res.noPedido)}</div>
      <p>${res.totalPiezas} piezas · ${money(res.totalImporte)}<br>${esc(res.mensaje || "")}</p>
      <div class="timeline" style="max-width:420px;margin:0 auto 26px">
        <div class="tl-step done"><div class="tl-dot"></div><span>Recibido</span></div>
        <div class="tl-step now"><div class="tl-dot"></div><span>Confirmado</span></div>
        <div class="tl-step"><div class="tl-dot"></div><span>En ruta</span></div>
        <div class="tl-step"><div class="tl-dot"></div><span>Entregado</span></div>
      </div>
      <button class="btn btn-bosque" data-go="pedidos">Ver mis pedidos</button>
    </div>`;
    go("exito");
  }

  /* ── Mis pedidos ── */
  const PASOS = { PENDIENTE: 1, CONFIRMADO: 2, ENTREGADO: 4, FACTURADO: 4 };
  function timelineHTML(estado) {
    if (estado === "CANCELADO") return '<div class="tl-cancelado">✗ Pedido cancelado</div>';
    const paso = PASOS[estado] || 1;
    const steps = ["Recibido", "Confirmado", "En ruta", "Entregado"];
    return '<div class="timeline">' + steps.map((s, i) => {
      const n = i + 1;
      const cls = n < paso ? "done" : n === paso ? "done now" : "";
      return `<div class="tl-step ${cls}"><div class="tl-dot"></div><span>${s}</span></div>`;
    }).join("") + "</div>";
  }

  async function precargarPedidos() {
    const res = await API.misPedidos(SESION.token);
    if (res.ok) {
      PEDIDOS_CACHE = res.pedidos || [];
      ULTIMO_PEDIDO = PEDIDOS_CACHE.find(p => p.estado !== "CANCELADO") || null;
      $("acc-repedir-sub").textContent = ULTIMO_PEDIDO
        ? `Tu último pedido ${ULTIMO_PEDIDO.noPedido} · ${ULTIMO_PEDIDO.totalPiezas} pzas`
        : "Aún no tienes pedidos";
    }
  }

  async function cargarPedidos(forzar) {
    if (!PEDIDOS_CACHE.length || forzar) {
      $("lista-pedidos").innerHTML = '<div class="cargando"><div class="spinner"></div>Cargando…</div>';
      const res = await API.misPedidos(SESION.token);
      if (!res.ok) { $("lista-pedidos").innerHTML = `<div class="msg msg-error">${esc(res.mensaje)}</div>`; return; }
      PEDIDOS_CACHE = res.pedidos || [];
    }
    $("ped-sub").textContent = PEDIDOS_CACHE.length + " pedidos";
    if (!PEDIDOS_CACHE.length) {
      $("lista-pedidos").innerHTML = '<div class="vacio">Aún no tienes pedidos. ¡Haz el primero desde el catálogo!</div>';
      return;
    }
    $("lista-pedidos").innerHTML = PEDIDOS_CACHE.map(p => `
      <div class="ped-card">
        <div class="ped-head">
          <span class="folio">${esc(p.noPedido)}</span>
          <span class="estado e-${esc(p.estado)}">${esc(p.estado)}</span>
          <span class="monto">${money(p.totalImporte)}</span>
        </div>
        <div class="ped-meta">Pedido el ${esc(p.fechaPedido)} · ${p.totalPiezas} piezas${p.fechaEntrega ? " · Entrega: " + esc(p.fechaEntrega) : ""}</div>
        ${timelineHTML(p.estado)}
        <div class="ped-foot">
          <button class="btn btn-linea btn-sm" data-detalle="${esc(p.noPedido)}">Ver detalle</button>
          ${p.estado !== "CANCELADO" ? `<button class="btn btn-bosque btn-sm" data-repedir="${esc(p.noPedido)}">🔄 Pedir de nuevo</button>` : ""}
        </div>
      </div>`).join("");
  }

  /* ── Detalle / re-pedir ── */
  function abrirModal(titulo, bodyHTML) {
    $("modal-titulo").textContent = titulo;
    $("modal-body").innerHTML = bodyHTML;
    $("modal-bg").classList.add("open");
  }
  const cerrarModal = () => $("modal-bg").classList.remove("open");

  async function verDetalle(noPedido) {
    abrirModal(noPedido, '<div class="cargando"><div class="spinner"></div></div>');
    const res = await API.detallePedido(SESION.token, noPedido);
    if (!res.ok) { $("modal-body").innerHTML = `<div class="msg msg-error">${esc(res.mensaje)}</div>`; return; }
    const c = res.cabecera || {};
    const items = res.items || [];
    $("modal-body").innerHTML = `
      <div class="detalle-row"><span class="lbl">Estado</span><span class="estado e-${esc(c.estado)}">${esc(c.estado)}</span></div>
      <div class="detalle-row"><span class="lbl">Fecha pedido</span><span>${esc(c.fechaPedido || "")}</span></div>
      ${c.fechaEntrega ? `<div class="detalle-row"><span class="lbl">Entrega</span><span>${esc(c.fechaEntrega)}</span></div>` : ""}
      <h4 style="margin:14px 0 6px;font-family:var(--disp);color:var(--bosque)">Artículos (${items.length})</h4>
      ${items.map(i => `
        <div class="detalle-row">
          <span>${fmt(i.nombre)}${i.codPropio ? `<br><small style="color:#A8AC9C">${esc(i.codPropio)}</small>` : ""}</span>
          <span style="text-align:right">${i.cantidad} × ${money(i.precioUnitario)}<br><b style="color:var(--hoja)">${money(i.subtotal)}</b></span>
        </div>`).join("")}
      <div class="detalle-row" style="font-weight:800;border:none;margin-top:6px">
        <span>Total</span><span style="color:var(--bosque);font-size:1.1rem">${money(c.totalImporte)}</span>
      </div>
      ${c.estado !== "CANCELADO" ? `<button class="btn btn-bosque btn-block" style="margin-top:14px" data-repedir="${esc(noPedido)}">🔄 Pedir de nuevo</button>` : ""}`;
  }

  async function rePedir(noPedido) {
    toast("Cargando tu pedido…");
    const res = await API.detallePedido(SESION.token, noPedido);
    if (!res.ok) { toast("No se pudo cargar el pedido"); return; }
    let ok = 0, fuera = [];
    (res.items || []).forEach(i => {
      const p = byCod((i.codigo || "").toString());
      if (p && (p.stock === null ? p.disponible : p.stock > 0)) { CART[p.codigo] = (CART[p.codigo] || 0) + (+i.cantidad || 1); ok++; }
      else fuera.push(i.nombre || i.codigo);
    });
    persistCart(); cerrarModal();
    toast(fuera.length ? `${ok} productos al carrito · ${fuera.length} sin existencia` : `${ok} productos al carrito ✓`, 3000);
    if (ok) go("carrito");
  }

  /* ── Listas guardadas ── */
  async function guardarComoLista() {
    const nombre = prompt("Nombre de la lista (ej. Pedido semanal):");
    if (!nombre) return;
    const items = Object.entries(CART).map(([codigo, cantidad]) => ({ codigo, cantidad }));
    const res = await API.guardarLista(SESION.token, nombre, items);
    toast(res.ok ? res.mensaje : "Error: " + res.mensaje, 3000);
  }

  async function verListas() {
    abrirModal("Mis listas guardadas", '<div class="cargando"><div class="spinner"></div></div>');
    const res = await API.misListas(SESION.token);
    if (!res.ok) { $("modal-body").innerHTML = `<div class="msg msg-error">${esc(res.mensaje)}</div>`; return; }
    const listas = res.listas || [];
    $("modal-body").innerHTML = listas.length
      ? listas.map((l, i) => `
        <div class="lista-item">
          <b>${esc(l.nombre)}</b>
          <span>${l.items.length} productos · ${esc(l.actualizado)}</span>
          <button class="btn btn-bosque btn-sm" data-cargarlista="${i}">Al carrito</button>
        </div>`).join("")
      : '<div class="vacio" style="padding:30px">Aún no guardas listas.<br>Arma un carrito y tócale "Guardar como lista".</div>';
    $("modal-body")._listas = listas;
  }

  function cargarLista(idx) {
    const listas = $("modal-body")._listas || [];
    const l = listas[idx]; if (!l) return;
    let ok = 0;
    l.items.forEach(i => {
      const p = byCod((i.codigo || "").toString().toUpperCase());
      if (p) { CART[p.codigo] = (CART[p.codigo] || 0) + (+i.cantidad || 1); ok++; }
    });
    persistCart(); cerrarModal();
    toast(`Lista "${l.nombre}": ${ok} productos al carrito ✓`, 2800);
    go("carrito");
  }

  /* ── Pedido rápido ── */
  function validarQO() {
    if (!CATALOGO.length) { toast("Espera, el catálogo sigue cargando…"); return; }
    const lineas = $("qo-text").value.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lineas.length) { toast("Pega al menos un renglón código,cantidad"); return; }
    QO_OK = [];
    const propioMap = {};
    CATALOGO.forEach(p => { if (p.codPropio) propioMap[norm(p.codPropio)] = p; });
    $("qo-result").innerHTML = lineas.map(l => {
      const [codS, qtyS] = l.split(/[,;\t]/).map(s => (s || "").trim());
      const qty = parseInt(qtyS);
      const p = byCod((codS || "").toUpperCase()) || propioMap[norm(codS)];
      if (!p)             return `<div class="qo-row err">✗ <b>${esc(codS || l)}</b> no encontrado — revisa el código</div>`;
      if (!qty || qty <= 0) return `<div class="qo-row err">✗ <b>${fmt(p.descripcion || p.nombre)}</b> cantidad inválida</div>`;
      const sin = p.stock !== null ? p.stock < qty : !p.disponible;
      if (sin) return `<div class="qo-row err">✗ <b>${fmt(p.descripcion || p.nombre)}</b> stock insuficiente${p.stock !== null ? ` (hay ${p.stock}, pides ${qty})` : ""}</div>`;
      QO_OK.push({ codigo: p.codigo, qty });
      return `<div class="qo-row">✓ <b>${fmt(p.descripcion || p.nombre)}</b> ${qty} pzas · ${money(precioEf(p) * qty)}</div>`;
    }).join("");
    $("qo-add").hidden = !QO_OK.length;
  }

  function agregarQO() {
    QO_OK.forEach(({ codigo, qty }) => CART[codigo] = (CART[codigo] || 0) + qty);
    QO_OK = []; $("qo-result").innerHTML = ""; $("qo-add").hidden = true; $("qo-text").value = "";
    persistCart(); toast("Productos agregados ✓");
    go("carrito");
  }

  /* ── Eventos (delegación global) ── */
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-go],[data-grupo],[data-add],[data-delta],[data-ficha],[data-detalle],[data-repedir],[data-cargarlista],[data-fgrupo]");
    if (!t) return;
    if (t.dataset.go !== undefined && t.dataset.go !== "") return go(t.dataset.go);
    if (t.dataset.grupo !== undefined) {
      return t.dataset.grupo === "__ofertas"
        ? irCatalogo({ soloOfertas: true })
        : irCatalogo({ grupo: t.dataset.grupo });
    }
    if (t.dataset.add)    return add(t.dataset.add);
    if (t.dataset.delta)  { const [c, d] = t.dataset.delta.split(","); return delta(c, parseInt(d)); }
    if (t.dataset.ficha)  return ficha(t.dataset.ficha);
    if (t.dataset.detalle) return verDetalle(t.dataset.detalle);
    if (t.dataset.repedir) return rePedir(t.dataset.repedir);
    if (t.dataset.cargarlista !== undefined) return cargarLista(+t.dataset.cargarlista);
  });
  document.addEventListener("change", e => {
    if (e.target.id === "f-stock")   { FILTRO.soloStock = e.target.checked; PAGINA = 1; renderCatalogo(); }
    if (e.target.id === "f-ofertas") { FILTRO.soloOfertas = e.target.checked; PAGINA = 1; renderCatalogo(); }
    if (e.target.dataset.fgrupo !== undefined) { FILTRO.grupo = e.target.dataset.fgrupo; PAGINA = 1; renderCatalogo(); }
  });

  let buscarTm = null;
  $("buscar").addEventListener("input", e => {
    clearTimeout(buscarTm);
    buscarTm = setTimeout(() => {
      FILTRO.texto = e.target.value.trim(); PAGINA = 1;
      if (!$("s-catalogo").classList.contains("on")) go("catalogo"); else renderCatalogo();
    }, 160);
  });
  $("btn-mas").onclick = () => { PAGINA++; renderCatalogo(); };
  $("login-btn").onclick = doLogin;
  $("login-pwd").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  $("pwd-ojo").onclick = () => {
    const inp = $("login-pwd");
    inp.type = inp.type === "password" ? "text" : "password";
    inp.focus();
  };
  $("login-usr").addEventListener("keydown", e => { if (e.key === "Enter") $("login-pwd").focus(); });
  $("btn-salir").onclick = doLogout;
  $("acc-repedir").onclick = () => ULTIMO_PEDIDO ? rePedir(ULTIMO_PEDIDO.noPedido) : irCatalogo({});
  $("acc-listas").onclick = verListas;
  $("qo-validar").onclick = validarQO;
  $("qo-limpiar").onclick = () => { $("qo-text").value = ""; $("qo-result").innerHTML = ""; $("qo-add").hidden = true; };
  $("qo-agregar").onclick = agregarQO;
  $("modal-cerrar").onclick = cerrarModal;
  $("modal-bg").addEventListener("click", e => { if (e.target === $("modal-bg")) cerrarModal(); });
  $("btn-wa").onclick = () => {
    const num = MV4_CONFIG.WHATSAPP_ASESOR;
    if (num) window.open("https://wa.me/" + num, "_blank");
    else toast("Pide a DMD configurar el WhatsApp de tu asesor 💬");
  };

  /* ── Init ── */
  (function init() {
    const s = Session.get();
    if (s && s.token) { SESION = s; entrar(); }
    // PWA: service worker (solo https o localhost)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  })();

  return { irLogin, go };
})();
