// sw-queue.js - Manejador de cola persistente serializada para el Service Worker de Salem

(function (global) {
  /**
   * Mutex basado en cadenas de promesas para serializar operaciones de lectura-modificación-escritura.
   * @type {Promise<void>}
   */
  let queueMutex = Promise.resolve();

  /**
   * @description Ejecuta una operación asíncrona dentro del bloqueo de exclusión mutua de la cola persistente.
   *
   * @param {Function} operation - Función asíncrona que realiza operaciones sobre la cola.
   *
   * @returns {Promise<*>} Promesa que resuelve con el resultado devuelto por la operación ejecutada.
   */
  function withQueueLock(operation) {
    const next = queueMutex.then(operation, operation);
    queueMutex = next.catch(() => {});
    return next;
  }

  const SwQueue = {
    /**
     * @description Lee directamente el arreglo de eventos activos desde chrome.storage.local.
     *
     * @returns {Promise<Array<Object>>} Promesa que resuelve con el arreglo de eventos en cola.
     */
    read: function () {
      return new Promise((resolve) => {
        chrome.storage.local.get(global.SwRules.queueKey, (res) => {
          let queue = res && res[global.SwRules.queueKey];
          if (!Array.isArray(queue)) {
            queue = [];
          }
          resolve(queue);
        });
      });
    },

    /**
     * @description Escribe directamente el arreglo de eventos en chrome.storage.local.
     *
     * @param {Array<Object>} queue - Arreglo de eventos a persistir.
     *
     * @returns {Promise<void>} Promesa que resuelve al completar la escritura en almacenamiento.
     * @throws {Error} Excepción capturada desde chrome.runtime.lastError si la escritura falla.
     */
    write: function (queue) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [global.SwRules.queueKey]: queue }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    },

    /**
     * @description Lee el historial rotativo de eventos enviados con éxito para fines de auditoría y diagnóstico.
     *
     * @returns {Promise<Array<Object>>} Promesa que resuelve con el arreglo de eventos enviados recientemente.
     */
    readSentHistory: function () {
      return new Promise((resolve) => {
        chrome.storage.local.get(global.SwRules.historyKey, (res) => {
          let history = res && res[global.SwRules.historyKey];
          if (!Array.isArray(history)) {
            history = [];
          }
          resolve(history);
        });
      });
    },

    /**
     * @description Registra un evento finalizado en el historial rotativo conservando hasta el límite configurado.
     *
     * @param {Object} item - Objeto de evento con estado sent y fecha de finalización.
     *
     * @returns {Promise<void>} Promesa que resuelve al actualizar el historial.
     */
    recordSentHistory: function (item) {
      return new Promise((resolve) => {
        chrome.storage.local.get(global.SwRules.historyKey, (res) => {
          let history = res && res[global.SwRules.historyKey];
          if (!Array.isArray(history)) {
            history = [];
          }
          history.unshift(item);
          const limit = global.SwRules.maxHistoryItems || 50;
          if (history.length > limit) {
            history = history.slice(0, limit);
          }
          chrome.storage.local.set({ [global.SwRules.historyKey]: history }, () => {
            resolve();
          });
        });
      });
    },

    /**
     * @description Encola un nuevo evento de forma serializada en almacenamiento local con estado inicial pending.
     *
     * @param {Object} eventData - Datos del evento a encolar.
     * @param {string} eventData.id - Identificador único del evento.
     * @param {string} [eventData.type="SALEM_MRA"] - Tipo de evento procesado.
     * @param {number|null} [eventData.tabId] - Identificador numérico de la pestaña emisora.
     * @param {string|null} [eventData.ticketNumber] - Número de ticket asociado.
     * @param {string|number|null} [eventData.ticketId] - ID interno de OTOBO del ticket.
     * @param {number} [eventData.attempts=0] - Contador inicial de intentos.
     * @param {number} [eventData.createdAt] - Marca de tiempo unix de creación.
     * @param {Object} [eventData.payload] - Contenido del mensaje y paquetes a procesar.
     *
     * @returns {Promise<Object>} Promesa que resuelve con el objeto de evento normalizado y persistido.
     */
    enqueue: function (eventData) {
      return withQueueLock(async () => {
        const queue = await SwQueue.read();
        const item = {
          id: eventData.id,
          type: eventData.type || "SALEM_MRA",
          tabId: eventData.tabId || null,
          ticketNumber: eventData.ticketNumber || null,
          ticketId: eventData.ticketId || null,
          status: "pending",
          attempts: eventData.attempts || 0,
          createdAt: eventData.createdAt || Date.now(),
          lastAttemptAt: null,
          sentAt: null,
          payload: eventData.payload || null,
        };
        queue.push(item);
        await SwQueue.write(queue);
        return item;
      });
    },

    /**
     * @description Transiciona un evento al estado sending y actualiza la marca de tiempo de intento.
     *
     * @param {string} eventId - Identificador único del evento en cola.
     *
     * @returns {Promise<Object|null>} Promesa que resuelve con el evento modificado o null si no se encontró.
     */
    markSending: function (eventId) {
      return withQueueLock(async () => {
        const queue = await SwQueue.read();
        const item = queue.find((ev) => ev.id === eventId);
        if (item) {
          item.status = "sending";
          item.lastAttemptAt = Date.now();
          await SwQueue.write(queue);
          return item;
        }
        return null;
      });
    },

    /**
     * @description Marca un evento como enviado exitosamente, lo retira de la cola activa y lo registra en el historial.
     *
     * @param {string} eventId - Identificador único del evento completado.
     *
     * @returns {Promise<Object|null>} Promesa que resuelve con el evento finalizado o null si no existía.
     */
    markSent: function (eventId) {
      return withQueueLock(async () => {
        const queue = await SwQueue.read();
        const index = queue.findIndex((ev) => ev.id === eventId);
        if (index !== -1) {
          const [item] = queue.splice(index, 1);
          item.status = "sent";
          item.sentAt = Date.now();
          await SwQueue.write(queue);
          await SwQueue.recordSentHistory(item);
          return item;
        }
        return null;
      });
    },

    /**
     * @description Marca un evento para reintento programado, restableciendo su estado a pending.
     *
     * @param {string} eventId - Identificador único del evento.
     * @param {number} attempt - Número ordinal del intento ejecutado.
     *
     * @returns {Promise<Object|null>} Promesa que resuelve con el evento actualizado o null si no existía.
     */
    markRetry: function (eventId, attempt) {
      return withQueueLock(async () => {
        const queue = await SwQueue.read();
        const item = queue.find((ev) => ev.id === eventId);
        if (item) {
          item.status = "pending";
          item.attempts = attempt;
          item.lastAttemptAt = Date.now();
          await SwQueue.write(queue);
          return item;
        }
        return null;
      });
    },

    /**
     * @description Marca un evento como fallido definitivo conservándolo en cola para inspección forense.
     *
     * @param {string} eventId - Identificador único del evento.
     * @param {number} attempt - Total de intentos alcanzados.
     * @param {string} errorMsg - Causa o descripción textual del fallo.
     *
     * @returns {Promise<Object|null>} Promesa que resuelve con el evento en estado failed o null si no se encontró.
     */
    markFailed: function (eventId, attempt, errorMsg) {
      return withQueueLock(async () => {
        const queue = await SwQueue.read();
        const item = queue.find((ev) => ev.id === eventId);
        if (item) {
          item.status = "failed";
          item.attempts = attempt;
          item.lastAttemptAt = Date.now();
          item.error = errorMsg || "Error desconocido";
          await SwQueue.write(queue);
          return item;
        }
        return null;
      });
    },

    /**
     * @description Detecta eventos en estado sending que superaron el tiempo límite de espera y los retorna a pending.
     *
     * @param {number} timeoutMs - Tiempo en milisegundos para considerar un evento desatendido o atascado.
     *
     * @returns {Promise<number>} Promesa que resuelve con la cantidad de eventos recuperados.
     */
    recoverStuck: function (timeoutMs) {
      return withQueueLock(async () => {
        const queue = await SwQueue.read();
        const now = Date.now();
        let count = 0;
        queue.forEach((ev) => {
          if (ev.status === "sending") {
            const timeSinceAttempt = now - (ev.lastAttemptAt || 0);
            if (timeSinceAttempt > timeoutMs) {
              ev.status = "pending";
              count++;
              console.log(
                `[SALEM][QUEUE][RECOVER] eventId=${ev.id} tabId=${ev.tabId} ticketNumber=${ev.ticketNumber} ticketId=${ev.ticketId} attempt=${ev.attempts}`
              );
            }
          }
        });
        if (count > 0) {
          await SwQueue.write(queue);
        }
        return count;
      });
    },

    /**
     * @description Genera una instantánea diagnóstica consolidando la cola viva y el historial de eventos enviados.
     *
     * @returns {Promise<{items: Array<Object>, recentSent: Array<Object>, totals: {Total: number, Pending: number, Sending: number, Sent: number, Failed: number}}>}
     */
    getDebugSnapshot: function () {
      return withQueueLock(async () => {
        const queue = await SwQueue.read();
        const history = await SwQueue.readSentHistory();
        const totals = {
          Total: queue.length + history.length,
          Pending: 0,
          Sending: 0,
          Sent: history.length,
          Failed: 0,
        };
        queue.forEach((ev) => {
          if (ev.status === "pending") totals.Pending++;
          else if (ev.status === "sending") totals.Sending++;
          else if (ev.status === "failed") totals.Failed++;
        });
        return {
          items: queue,
          recentSent: history,
          totals: totals,
        };
      });
    },
  };

  /**
   * @description Función de diagnóstico expuesta globalmente en el Service Worker para inspección por consola.
   *
   * @returns {Promise<Object>} Promesa que resuelve con la instantánea diagnóstica de la cola.
   */
  global.salemDebug = async function () {
    const snapshot = await SwQueue.getDebugSnapshot();
    console.log("=== [SALEM QUEUE DEBUG SNAPSHOT] ===");
    console.table(
      snapshot.items.map((it) => ({
        eventId: it.id,
        type: it.type,
        tabId: it.tabId,
        ticket: it.ticketNumber || it.ticketId || "N/A",
        status: it.status,
        attempts: it.attempts,
        createdAt: new Date(it.createdAt).toLocaleTimeString(),
        lastAttemptAt: it.lastAttemptAt
          ? new Date(it.lastAttemptAt).toLocaleTimeString()
          : "N/A",
        error: it.error || "None",
      }))
    );
    console.log("Totales:", snapshot.totals);
    return snapshot;
  };

  global.SwQueue = SwQueue;
})(typeof self !== "undefined" ? self : this);
