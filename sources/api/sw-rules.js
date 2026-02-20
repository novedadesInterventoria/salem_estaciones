// sw-rules.js - Constantes y configuración para el Service Worker de Salem (sin dependencias de DOM)

/**
 * @typedef {Object} SwRulesConfig
 * @property {string} storageKey - Clave utilizada para acceder a la memoria global en chrome.storage.local.
 * @property {string} queueKey - Clave del arreglo persistente de eventos pendientes en chrome.storage.local.
 * @property {string} historyKey - Clave del historial rotativo de eventos enviados para observabilidad.
 * @property {Object} api - Endpoints remotos de Google Apps Script.
 * @property {string} api.dev - Endpoint de desarrollo con parámetro de token.
 * @property {string} api.prod - Endpoint principal de producción.
 * @property {string} api.workspace - Endpoint corporativo de respaldo.
 * @property {Object} routes - Rutas de integración web.
 * @property {string} routes.otrs - URL base del sistema OTOBO.
 * @property {Object} alarms - Identificadores y cadencias de alarmas del Service Worker.
 * @property {string} alarms.retryAlarmName - Nombre de la alarma para reintentos de cola.
 * @property {string} alarms.watchdogAlarmName - Nombre de la alarma para verificación periódica.
 * @property {number} alarms.watchdogPeriodMinutes - Intervalo en minutos del watchdog.
 * @property {Array<number>} retryBackoffsMs - Tiempos de espera en milisegundos para reintentos progresivos.
 * @property {number} maxRetries - Cantidad máxima de reintentos por evento antes de marcar fallo definitivo.
 * @property {number} stuckTimeoutMs - Tiempo en milisegundos tras el cual un evento en envío se considera atascado.
 * @property {number} fetchTimeoutMs - Tiempo límite en milisegundos para peticiones remotas a GAS.
 * @property {number} maxHistoryItems - Cantidad máxima de eventos finalizados conservados en el historial.
 */

self.SwRules = {
  storageKey: "salemMemory",
  queueKey: "salem_queue",
  historyKey: "salem_queue_history",
  api: {
    dev: "https://script.google.com/macros/s/AKfycbw9iEQ5I8ZXqHyMG8KbvkSKqP9CLkc7UKGeYMFk9WY/dev?access_token=",
    prod: "https://script.google.com/macros/s/AKfycbxIjCSxv1abCQE0kk4BWALYSsM3HuHd1kvlHu2a41JSnAJfOVmB1-kXBqp7oEgmdKO5/exec",
    workspace: "https://script.google.com/a/macros/rbsas.co/s/AKfycbxIjCSxv1abCQE0kk4BWALYSsM3HuHd1kvlHu2a41JSnAJfOVmB1-kXBqp7oEgmdKO5/exec",
  },
  routes: {
    otrs: "https://helpdesk.rbsas.co/otobo/index.pl"
  },
  alarms: {
    retryAlarmName: "salem_queue_retry",
    watchdogAlarmName: "salem_queue_watchdog",
    watchdogPeriodMinutes: 1
  },
  retryBackoffsMs: [
    30 * 1000,       // Intento 1: 30s
    2 * 60 * 1000,   // Intento 2: 2min
    10 * 60 * 1000   // Intento 3: 10min
  ],
  maxRetries: 3,
  stuckTimeoutMs: 60 * 1000, // 60 segundos
  fetchTimeoutMs: 15 * 1000, // 15 segundos
  maxHistoryItems: 50
};

/**
 * @description Obtiene el objeto de memoria global almacenado en chrome.storage.local bajo la clave principal de Salem.
 *
 * @returns {Promise<Object|null>} Promesa que resuelve con el objeto de configuración y sesión del usuario, o null si no existe.
 */
self.SwRules.getMemory = function () {
  return new Promise((resolve) => {
    chrome.storage.local.get(self.SwRules.storageKey, (res) => {
      resolve(res ? res[self.SwRules.storageKey] : null);
    });
  });
};
