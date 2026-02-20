// background.js - Service Worker principal de Salem V1.2.3.5

importScripts(
  "/sources/api/sw-rules.js",
  "/sources/api/sw-queue.js"
);

console.log("[SALEM] Service Worker background script loaded");

// Inicialización de menús, alarmas y arranque
chrome.runtime.onInstalled.addListener(() => {
  registerContextualMenu();
  setupWatchdogAlarm();
  processQueue();
});

chrome.runtime.onStartup.addListener(() => {
  setupWatchdogAlarm();
  processQueue();
});

// Asegurar que el watchdog esté configurado al inicializarse el Service Worker
setupWatchdogAlarm();

// Escuchador de alarmas separando conceptualmente Retry y Watchdog
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm) {
    if (alarm.name === SwRules.alarms.retryAlarmName) {
      console.log("[SALEM][ALARM][RETRY] Disparando reintento programado de la cola");
      processQueue();
    } else if (alarm.name === SwRules.alarms.watchdogAlarmName) {
      console.log("[SALEM][ALARM][WATCHDOG] Disparando verificación periódica de recuperación de cola");
      processQueue();
    }
  }
});

// Escuchador de clic en el icono de acción de la extensión
chrome.action.onClicked.addListener(createPopup);

// Escuchador de mensajes desde Content Scripts y UI
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "SALEM_MRA") {
    handleMraMessage(message, sender).then(sendResponse);
    return true; // Retorno true para responder asíncronamente
  }
});

/**
 * @description Configura la alarma periódica de supervisión (watchdog) evitando duplicados en el runtime.
 *
 * @returns {void}
 */
function setupWatchdogAlarm() {
  chrome.alarms.get(SwRules.alarms.watchdogAlarmName, (existingAlarm) => {
    if (!existingAlarm) {
      chrome.alarms.create(SwRules.alarms.watchdogAlarmName, {
        periodInMinutes: SwRules.alarms.watchdogPeriodMinutes,
      });
      console.log(
        `[SALEM][WATCHDOG] Alarma periódica de recuperación configurada cada ${SwRules.alarms.watchdogPeriodMinutes} min.`
      );
    }
  });
}

/**
 * @description Procesa los mensajes MRA entrantes, validando la identidad de la pestaña emisora y encolando el evento antes del acuse de recibo.
 *
 * @param {Object} message - Objeto del mensaje recibido.
 * @param {string} message.type - Tipo de mensaje ("SALEM_MRA").
 * @param {Object} message.payload - Paquetes de datos y configuración del evento.
 * @param {chrome.runtime.MessageSender} sender - Metadatos de la pestaña y contexto emisor del mensaje.
 * @param {chrome.tabs.Tab} [sender.tab] - Información de la pestaña del navegador.
 * @param {number} [sender.tab.id] - Identificador numérico de la pestaña.
 *
 * @returns {Promise<{received: boolean, eventId?: string, tabId?: number, error?: string}>}
 */
async function handleMraMessage(message, sender) {
  try {
    const tabId =
      sender && sender.tab && typeof sender.tab.id === "number"
        ? sender.tab.id
        : null;

    if (tabId === null) {
      console.error(
        "[SALEM][EVENT][REJECTED] Mensaje SALEM_MRA rechazado: sender.tab.id no es válido o está ausente."
      );
      return {
        received: false,
        error: "Identidad de pestaña no válida (sender.tab.id ausente)",
      };
    }

    const otrs = (message.payload && message.payload.otrs) || {};
    const ticketNumber =
      otrs.ticket || otrs.TicketNumber || otrs["Ticket Número"] || null;
    const ticketId = otrs.id || otrs.TicketID || null;

    const eventId =
      "mra_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);

    console.log(
      `[SALEM][EVENT][RECEIVED] eventId=${eventId} tabId=${tabId} ticketNumber=${ticketNumber} ticketId=${ticketId}`
    );

    const eventData = {
      id: eventId,
      type: "SALEM_MRA",
      tabId: tabId,
      ticketNumber: ticketNumber,
      ticketId: ticketId,
      status: "pending",
      attempts: 0,
      createdAt: Date.now(),
      lastAttemptAt: null,
      sentAt: null,
      payload: message.payload,
    };

    await SwQueue.enqueue(eventData);

    console.log(
      `[SALEM][QUEUE][ENQUEUED] eventId=${eventId} tabId=${tabId} ticketNumber=${ticketNumber} ticketId=${ticketId} attempt=0`
    );

    processQueue();

    return {
      received: true,
      eventId: eventId,
      tabId: tabId,
    };
  } catch (error) {
    console.error("[SALEM][EVENT][ERROR] Error procesando evento MRA:", error);
    return {
      received: false,
      error:
        error && error.message
          ? error.message
          : "Error interno en Service Worker",
    };
  }
}

/**
 * Indicador de exclusión mutua para la ejecución secuencial de la cola en el Service Worker.
 * @type {boolean}
 */
let isProcessingQueue = false;

/**
 * @description Procesa secuencialmente los eventos pendientes en la cola persistente con manejo de reintentos y tolerancia a fallos.
 *
 * @returns {Promise<void>}
 */
async function processQueue() {
  if (isProcessingQueue) {
    return;
  }
  isProcessingQueue = true;

  try {
    await SwQueue.recoverStuck(SwRules.stuckTimeoutMs);

    let hasMore = true;
    while (hasMore) {
      const queue = await SwQueue.read();
      const nextPending = queue.find((ev) => ev.status === "pending");

      if (!nextPending) {
        hasMore = false;
        break;
      }

      const item = await SwQueue.markSending(nextPending.id);
      if (!item) {
        continue;
      }

      const currentAttempt = item.attempts + 1;
      console.log(
        `[SALEM][QUEUE][SENDING] eventId=${item.id} tabId=${item.tabId} ticketNumber=${item.ticketNumber} ticketId=${item.ticketId} attempt=${currentAttempt}`
      );

      const gasPayload = {
        action: "runtime",
        subaction: "mra",
        package: item.payload && item.payload.package,
        otrs: item.payload && item.payload.otrs,
        config: item.payload && item.payload.config,
        _salem: {
          eventId: item.id,
          tabId: item.tabId,
          ticketNumber: item.ticketNumber,
          ticketId: item.ticketId,
          type: item.type,
          attempt: currentAttempt,
        },
      };

      const res = await sendToGas(gasPayload);

      if (res && res.done === true) {
        await SwQueue.markSent(item.id);
        console.log(
          `[SALEM][QUEUE][SENT] eventId=${item.id} tabId=${item.tabId} ticketNumber=${item.ticketNumber} ticketId=${item.ticketId} attempt=${currentAttempt}`
        );
      } else {
        const errorMsg =
          (res && res.message) || (res && res.error) || "Fallo en respuesta GAS";
        if (currentAttempt < SwRules.maxRetries) {
          await SwQueue.markRetry(item.id, currentAttempt);
          const backoffMs =
            SwRules.retryBackoffsMs[currentAttempt - 1] || 30000;
          console.warn(
            `[SALEM][QUEUE][RETRY] eventId=${item.id} tabId=${item.tabId} ticketNumber=${item.ticketNumber} ticketId=${item.ticketId} attempt=${currentAttempt}/${SwRules.maxRetries} scheduled in ${backoffMs / 1000}s. Causa: ${errorMsg}`
          );
          scheduleRetryAlarm(backoffMs);
        } else {
          await SwQueue.markFailed(item.id, currentAttempt, errorMsg);
          console.error(
            `[SALEM][QUEUE][FAILED] eventId=${item.id} tabId=${item.tabId} ticketNumber=${item.ticketNumber} ticketId=${item.ticketId} attempt=${currentAttempt} (Máximo de reintentos alcanzado). Causa: ${errorMsg}`
          );
        }
      }
    }
  } catch (err) {
    console.error("[SALEM][QUEUE][PROCESS_ERROR]", err);
  } finally {
    isProcessingQueue = false;
  }
}

/**
 * @description Programa una alarma en el navegador para reintentar la cola tras el tiempo de espera indicado.
 *
 * @param {number} delayMs - Retardo en milisegundos para disparar la alarma.
 *
 * @returns {void}
 */
function scheduleRetryAlarm(delayMs) {
  const delayInMinutes = Math.max(0.1, delayMs / 60000);
  chrome.alarms.create(SwRules.alarms.retryAlarmName, { delayInMinutes });
}

/**
 * @description Envía el payload a los endpoints configurados de Google Apps Script con control de timeout por AbortController.
 *
 * @param {Object} payload - Objeto de datos con action, subaction, paquetes y metadatos de trazabilidad.
 *
 * @returns {Promise<{done: boolean, message?: string, error?: string}>}
 */
async function sendToGas(payload) {
  const storage = await SwRules.getMemory();
  const urlsToTry = [SwRules.api.prod, SwRules.api.workspace];
  if (storage && storage.dev) {
    urlsToTry.unshift(`${SwRules.api.dev}${storage.dev}`);
  }

  let lastErrorMsg = "";
  for (const apiUrl of urlsToTry) {
    if (!apiUrl) continue;

    const controller = new AbortController();
    const timeoutMs = SwRules.fetchTimeoutMs || 15000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify(payload),
        redirect: "follow",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const textData = await response.text();
        let parsed;
        try {
          parsed = JSON.parse(textData);
        } catch (e) {
          parsed = {
            done: false,
            message: "Respuesta no es JSON: " + textData.substring(0, 200),
          };
        }
        return parsed;
      } else {
        lastErrorMsg = `HTTP ${response.status}: ${response.statusText}`;
      }
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr && fetchErr.name === "AbortError") {
        lastErrorMsg = `Timeout excedido al conectar con GAS (${timeoutMs / 1000}s)`;
      } else {
        lastErrorMsg =
          fetchErr && fetchErr.message
            ? fetchErr.message
            : "Error de red al conectar con GAS";
      }
    }
  }

  return { done: false, message: lastErrorMsg || "Error de conexión con GAS" };
}

/**
 * @description Abre o enfoca la ventana panel del popup de Salem en la posición configurada por el usuario.
 *
 * @param {chrome.tabs.Tab} tab - Pestaña activa desde la cual se invocó la acción.
 *
 * @returns {Promise<void>}
 */
async function createPopup(tab) {
  let storage = await SwRules.getMemory();
  if (!tab) return;
  let params = {
    url: chrome.runtime.getURL(`sources/popup/index/index.html?tabId=${tab.id}`),
    type: "panel",
    height: 800,
    width: 900,
    left:
      storage && storage.login && storage.login.config
        ? storage.login.config.positionX
          ? parseInt(storage.login.config.positionX)
          : null
        : null,
    top:
      storage && storage.login && storage.login.config
        ? storage.login.config.positionY
          ? parseInt(storage.login.config.positionY)
          : null
        : null,
  };

  let allTabs = await chrome.tabs.query({});
  let thisUrl = chrome.runtime.getURL("");
  for (let thisTab of allTabs) {
    if (thisTab.url.includes(thisUrl)) {
      if (!thisTab.url.includes(tab.id))
        chrome.tabs.update(thisTab.id, { url: params.url });
      chrome.windows.update(thisTab.windowId, { focused: true });
      return;
    }
  }

  /**
   * @description Crea la ventana de la extensión en la posición por defecto del sistema
   * como fallback cuando las coordenadas calculadas (pantalla derecha) fallan.
   *
   * @returns {void}
   */
  function openInDefaultPosition() {
    params.left = undefined;
    params.top = undefined;
    chrome.windows.create(params);
  }

  try {
    chrome.windows.create(params, function (window) {
      if (typeof window == "undefined") {
        openInDefaultPosition();
      }
    });
  } catch (error) {
    openInDefaultPosition();
  }
}

/**
 * @description Registra las opciones del menú contextual de Chrome para inspección rápida de tickets.
 *
 * @returns {void}
 */
function registerContextualMenu() {
  chrome.contextMenus.create({
    id: "ver_ticket",
    title: "Ver ticket",
    contexts: ["selection", "page", "link"],
  });
}

// Escuchador de clics en el menú contextual
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId) {
    if (info.menuItemId == "ver_ticket") {
      let windowId = null;
      let allWindows = await chrome.windows.getAll();
      if (allWindows.length >= 2) {
        let toOpenIn = allWindows.find((u) => u.focused == false);
        windowId = toOpenIn ? toOpenIn.id : null;
      }
      chrome.tabs.create({
        url: `${SwRules.routes.otrs}?Action=AgentTicketZoom;TicketNumber=${info.selectionText}`,
        windowId: windowId,
      });
    }
  }
});
