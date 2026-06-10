/* Configuración del Portal Cliente DMD 2.0
   Cambiar API_URL al deploy de producción el día del corte. */
const MV4_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbzL5nUUYdzr1pOAAAHlohrm52AVmC6l1J1dQ-L201GmsNwXJZKaaptR4INdorHwkbGqIA/exec", // DEV
  AMBIENTE: "DEV",
  CACHE_CATALOGO_MIN: 30,   // refresco automático del catálogo
  UMBRAL_DESC_VOLUMEN: 1000,
  PCT_DESC_VOLUMEN: 4,
  // Número del asesor con código de país, sin signos. Ej: "526441234567"
  WHATSAPP_ASESOR: "",
  VERSION: "2.0.0-dev"
};
