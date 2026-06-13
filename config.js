/* Configuración del Portal Cliente DMD 2.0
   Cambiar API_URL al deploy de producción el día del corte. */
const MV4_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbzDzqEapd-jVEYQz7CnJ9_9JmHEfsYYpcmdZqMdadhUz96gMM_XpxOAd_vUPKd-dllkFw/exec", // PRODUCCION
  AMBIENTE: "PROD",
  CACHE_CATALOGO_MIN: 30,   // refresco automático del catálogo
  // Descuento por volumen: ahora es solo informativo en la tarjeta y el carrito
  // ("consúltalo con tu asesor"). Ya no se calcula ni se muestra un % fijo.
  // Número del asesor con código de país, sin signos. Ej: "526441234567"
  WHATSAPP_ASESOR: "526531650860",
  VERSION: "2.0.0"
};
