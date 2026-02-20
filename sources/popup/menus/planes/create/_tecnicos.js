/**
 * @file _tecnicos.js — Módulo centralizado para técnicos de estaciones (Fuente: KNOWLEDGE / CONTACTS + Caché Local).
 *
 * ARQUITECTURA:
 *  1. Fuente Oficial: Hoja CONTACTS del libro KNOWLEDGE (CLOE).
 *     Se sincroniza a través de Salem API (storage.config.otrs.CONTACTS) y se persiste en localStorage / chrome.storage.
 *  2. Desplegable Rápido y Claro:
 *     - Muestra Cédula y Nombre (ej. "52874120 - NOMBRE TECNICO").
 *     - El valor que se envía a OTOBO es estrictamente la CÉDULA.
 *  3. Búsqueda y Edición Libre:
 *     - Permite buscar tanto por Cédula como por Nombre.
 *     - Si una cédula nueva no está en la lista oficial, permite digitarla libremente (create: true)
 *       y se preserva en manuales sin bloquear ni sobreescribir la lista oficial de KNOWLEDGE.
 *  4. Fusión Resiliente (Merge Oficiales + Manuales):
 *     - NUNCA se ocultan los contactos oficiales por tener técnicos manuales.
 *     - Si los oficiales tardan en resolver de memoria, el selector se actualiza reactivamente.
 */

(() => {
  const STORAGE_KEY_OFFICIAL = 'salem_tecnicos_official';
  const STORAGE_KEY_MANUAL = 'salem_tecnicos_manual';
  const LEGACY_STORAGE_KEY = 'salem_tecnicos';

  /**
   * Normaliza una clave eliminando tildes, mayúsculas, espacios y caracteres especiales.
   * @param {string} str
   * @returns {string}
   */
  function normalizeKey(str) {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Extrae la cédula y nombre de una fila de CONTACTS de forma tolerante a cualquier convención de columnas.
   * @param {Object} row
   * @returns {{value: string, name: string}|null}
   */
  function parseContactRow(row) {
    if (!row || typeof row !== 'object') return null;

    let rawCedula = '';
    let rawNombre = '';
    let rawFoco = '';

    for (const key of Object.keys(row)) {
      const norm = normalizeKey(key);
      const val = row[key];
      if (val === undefined || val === null) continue;
      const strVal = String(val).trim();
      if (!strVal) continue;

      if (!rawCedula && (
        norm === 'cedula' || norm === 'cc' || norm === 'documento' ||
        norm === 'identificacion' || norm === 'nodocumento' || norm === 'numerodocumento' ||
        norm === 'ceduladeciudadania' || norm === 'id' || norm === 'value' || norm === 'dni'
      )) {
        rawCedula = strVal;
      } else if (!rawNombre && (
        norm === 'nombre' || norm === 'nombres' || norm === 'nombrecompleto' ||
        norm === 'nombreyapellidos' || norm === 'tecnico' || norm === 'name' ||
        norm === 'contacto' || norm === 'funcionario' || norm === 'colaborador' ||
        norm === 'responsable'
      )) {
        rawNombre = strVal;
      } else if (!rawFoco && (
        norm === 'foco' || norm === 'area' || norm === 'zona' ||
        norm === 'departamento' || norm === 'focodemantenimiento'
      )) {
        rawFoco = strVal;
      }
    }

    // Heurística de respaldo: si no encontró cédula por nombre de columna,
    // buscar si algún valor numérico parece una cédula colombiana (6 a 12 dígitos)
    if (!rawCedula) {
      for (const key of Object.keys(row)) {
        const digits = String(row[key] || '').replace(/\D/g, '');
        if (digits.length >= 6 && digits.length <= 12) {
          rawCedula = digits;
          break;
        }
      }
    }

    // Descartar explícitamente si pertenece estrictamente a DCA o Buses
    if (rawFoco && /dca|buses/i.test(rawFoco)) {
      return null;
    }

    // Limpieza estricta de la cédula: extraer únicamente los dígitos numéricos
    // (resuelve casos como "1.020.345.678", "CC 52874120", espacios intermedios, etc.)
    const cleanCedula = String(rawCedula || '').replace(/\D/g, '').trim();
    if (cleanCedula.length < 6 || cleanCedula.length > 12) {
      return null;
    }

    const cleanNombre = String(rawNombre || '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const label = cleanNombre ? `${cleanCedula} - ${cleanNombre}` : cleanCedula;
    return { value: cleanCedula, name: label };
  }

  /**
   * Obtiene la lista de técnicos creados manualmente por el usuario.
   * @returns {Array<{value: string, name: string}>}
   */
  function getManualTecnicos() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_MANUAL);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter(t => t && t.value && /^\d{6,12}$/.test(String(t.value).trim()));
        }
      }
    } catch (_) {}
    return [];
  }

  /**
   * Guarda un técnico ingresado manualmente a la memoria local sin afectar la lista oficial.
   * @param {string} cedula
   */
  function addManualTecnico(cedula) {
    const clean = String(cedula || '').replace(/\D/g, '').trim();
    if (clean.length < 6 || clean.length > 12) return;

    const current = getManualTecnicos();
    if (!current.find(t => t.value === clean)) {
      current.push({ value: clean, name: clean });
      try {
        localStorage.setItem(STORAGE_KEY_MANUAL, JSON.stringify(current));
      } catch (_) {}
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [STORAGE_KEY_MANUAL]: current });
        }
      } catch (_) {}
    }
  }

  /**
   * Obtiene los técnicos oficiales guardados en caché local (localStorage / chrome.storage).
   * @returns {Array<{value: string, name: string}>}
   */
  function getCachedOfficialTecnicos() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_OFFICIAL) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(item => {
            const val = String(item.value || item.name || item || '').replace(/\D/g, '').trim();
            const lbl = String(item.name || item.value || item || '').trim();
            return { value: val, name: lbl || val };
          }).filter(t => t.value && t.value.length >= 6 && t.value.length <= 12);
        }
      }
    } catch (err) {
      console.warn('[SALEM][TECNICOS] Error leyendo caché local:', err);
    }
    return [];
  }

  /**
   * Combina de forma determinista la lista de técnicos oficiales con los manuales.
   * Los registros oficiales tienen prioridad (aportan el nombre completo "cédula - nombre").
   * @param {Array<{value: string, name: string}>} oficiales
   * @param {Array<{value: string, name: string}>} manuales
   * @returns {Array<{value: string, name: string}>}
   */
  function mergeTecnicos(oficiales, manuales) {
    const map = new Map();
    (manuales || []).forEach(m => {
      if (m && m.value) map.set(m.value, { value: m.value, name: m.name || m.value });
    });
    (oficiales || []).forEach(o => {
      if (o && o.value) map.set(o.value, { value: o.value, name: o.name || o.value });
    });
    return Array.from(map.values());
  }

  /**
   * Guarda los técnicos oficiales en la caché local persistente.
   * @param {Array<{value: string, name: string}>} lista
   */
  function saveOfficialTecnicos(lista) {
    if (!Array.isArray(lista) || lista.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY_OFFICIAL, JSON.stringify(lista));
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(lista));
    } catch (_) {}

    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          [STORAGE_KEY_OFFICIAL]: lista,
          [LEGACY_STORAGE_KEY]: lista
        });
      }
    } catch (_) {}
  }

  /**
   * Extrae la lista oficial de técnicos desde KNOWLEDGE / CONTACTS en memoria (storage.config.otrs).
   * @returns {Promise<Array<{value: string, name: string}>>}
   */
  async function loadFromKnowledgeStorage() {
    try {
      let storage = null;
      if (typeof Salem !== 'undefined' && Salem.core && Salem.core.mem) {
        storage = await Salem.core.mem.get();
      }

      // Respaldo defensivo directo a chrome.storage.local si Salem.core.mem no estaba disponible
      if (!storage && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const rawMem = await new Promise(res => chrome.storage.local.get('salemMemory', res));
        storage = rawMem && rawMem.salemMemory;
      }

      let rawContacts = null;
      if (storage && storage.config) {
        const otrs = storage.config.otrs;
        if (otrs) {
          rawContacts = otrs.CONTACTS ||
                        otrs.contacts ||
                        otrs.CONTACTOS ||
                        otrs.contactos ||
                        otrs.MATRIZ ||
                        otrs.TECNICOS ||
                        otrs.tecnicos ||
                        otrs.DIRECTORIO ||
                        otrs.directorio;

          // Búsqueda profunda en cualquier propiedad de otrs que sea un Array con personas
          if (!rawContacts) {
            for (const k of Object.keys(otrs)) {
              if (Array.isArray(otrs[k]) && otrs[k].length > 0 && typeof otrs[k][0] === 'object') {
                const sample = otrs[k][0];
                const sampleKeys = Object.keys(sample).map(normalizeKey);
                if (sampleKeys.some(sk => sk.includes('cedula') || sk.includes('doc') || sk.includes('tecnico') || sk.includes('contacto'))) {
                  rawContacts = otrs[k];
                  break;
                }
              }
            }
          }
        }

        if (!rawContacts) {
          rawContacts = storage.config.CONTACTS || storage.config.contacts;
        }
      }

      if (Array.isArray(rawContacts) && rawContacts.length > 0) {
        const processed = [];
        const seen = new Set();
        rawContacts.forEach(row => {
          const parsed = parseContactRow(row);
          if (parsed && !seen.has(parsed.value)) {
            seen.add(parsed.value);
            processed.push(parsed);
          }
        });

        if (processed.length > 0) {
          saveOfficialTecnicos(processed);
          console.log(`[SALEM][TECNICOS] ${processed.length} técnicos oficiales cargados desde KNOWLEDGE / CONTACTS.`);
          return processed;
        }
      }
    } catch (err) {
      console.warn('[SALEM][TECNICOS] Error al leer KNOWLEDGE / CONTACTS desde memoria:', err);
    }

    return getCachedOfficialTecnicos();
  }

  /**
   * Actualiza o inserta las opciones de TomSelect de forma incremental y reactiva.
   * @param {TomSelect} ts
   * @param {Array<{value: string, name: string}>} opciones
   */
  function updateTomSelect(ts, opciones) {
    if (!ts || !Array.isArray(opciones) || opciones.length === 0) return;
    const currentVal = ts.getValue();
    opciones.forEach(item => {
      if (!ts.options[item.value]) {
        ts.addOption({ value: item.value, name: item.name });
      } else if (ts.options[item.value].name !== item.name && item.name.includes(' - ')) {
        // Enriquecer el label si antes solo se tenía la cédula plana
        ts.updateOption(item.value, { value: item.value, name: item.name });
      }
    });
    ts.refreshOptions(false);
    if (currentVal) {
      ts.setValue(currentVal, true);
    }
  }

  /**
   * Monta el selector TomSelect en [name="tcampo"] de manera reactiva e inmediata.
   * @param {jQuery} $container
   * @param {Function} [onReady]
   */
  async function mountSelector($container, onReady) {
    const $select = $container.find('[name="tcampo"]');
    if (!$select.length) return;

    // 1. Obtener de inmediato lo que exista en caché (oficiales + manuales) para no trabar la interfaz
    const initialManuales = getManualTecnicos();
    const initialOficiales = getCachedOfficialTecnicos();
    let combinados = mergeTecnicos(initialOficiales, initialManuales);

    // 2. Si ya existe la instancia de TomSelect, actualizarla de inmediato
    let ts = $select[0].tomselect;
    if (ts) {
      updateTomSelect(ts, combinados);
      if (typeof onReady === 'function') onReady(ts, combinados);
    } else {
      // 3. Crear TomSelect con búsqueda rápida por cédula o nombre y soporte de digitación libre
      ts = new TomSelect($select[0], {
        valueField: 'value',
        labelField: 'name',
        searchField: ['value', 'name'],
        options: combinados,
        placeholder: 'Busque por cédula o nombre de técnico...',
        create: true,          // Si no está en la lista, permite digitarlo libremente
        createOnBlur: true,    // Si digita la cédula y pasa de campo, la conserva
        persist: true,
        maxItems: 1
      });

      // Si el usuario digita una cédula manual válida, guardarla en manuales
      ts.on('change', function (value) {
        const clean = String(value || '').replace(/\D/g, '').trim();
        if (clean.length >= 6 && clean.length <= 12) {
          addManualTecnico(clean);
        }
      });

      if (typeof onReady === 'function') {
        onReady(ts, combinados);
      }
    }

    // 4. SIEMPRE en background: consultar KNOWLEDGE / CONTACTS fresco desde storage
    // y actualizar el TomSelect con la totalidad de los técnicos oficiales
    loadFromKnowledgeStorage().then(freshOficiales => {
      if (freshOficiales && freshOficiales.length > 0) {
        const currentManuales = getManualTecnicos();
        const allFresh = mergeTecnicos(freshOficiales, currentManuales);
        if ($select[0] && $select[0].tomselect) {
          updateTomSelect($select[0].tomselect, allFresh);
        }
      } else {
        // Si la memoria no tenía CONTACTS (ej. usuario nuevo o primera instalación),
        // disparar sync() en background para descargarlo automáticamente de Google Sheets
        if (typeof Salem !== 'undefined' && Salem.core && Salem.core.runtime && typeof Salem.core.runtime.sync === 'function') {
          console.log('[SALEM][TECNICOS] Disparando sync() automático en background para obtener CONTACTS...');
          Salem.core.runtime.sync().then(() => {
            loadFromKnowledgeStorage().then(postSyncOficiales => {
              if (postSyncOficiales && postSyncOficiales.length > 0 && $select[0] && $select[0].tomselect) {
                const currentManuales = getManualTecnicos();
                updateTomSelect($select[0].tomselect, mergeTecnicos(postSyncOficiales, currentManuales));
              }
            });
          }).catch((err) => {
            console.warn('[SALEM][TECNICOS] Sync automático no completado:', err);
          });
        }
      }
    });
  }

  /**
   * Espera a que [name="tcampo"] esté presente en el DOM y lo monta.
   * @param {jQuery} $container
   * @param {Function} [onReady]
   */
  function tryMountOrObserve($container, onReady) {
    if ($container.find('[name="tcampo"]').length) {
      mountSelector($container, onReady);
      return;
    }

    const target = ($container[0] && document.contains($container[0]))
      ? $container[0]
      : document.body;

    const observer = new MutationObserver((_mutations, obs) => {
      try {
        if ($container.find('[name="tcampo"]').length) {
          obs.disconnect();
          mountSelector($container, onReady);
        }
      } catch (err) {
        obs.disconnect();
        console.error('[SALEM][TECNICOS] Error en MutationObserver:', err);
      }
    });

    observer.observe(target, { childList: true, subtree: true });
  }

  // API pública
  window.SalemTecnicos = {
    /**
     * Inicializa el selector de técnicos en el contenedor dado.
     * @param {HTMLElement|jQuery} container
     * @param {Function} [onReady]
     */
    init(container, onReady) {
      const $container = (container instanceof jQuery) ? container : $(container);
      tryMountOrObserve($container, onReady);
    },

    /**
     * Devuelve la lista consolidada actual de técnicos.
     */
    getTecnicos() {
      const manuales = getManualTecnicos();
      const oficiales = getCachedOfficialTecnicos();
      return mergeTecnicos(oficiales, manuales);
    },

    /**
     * Sincroniza los técnicos leyendo la matriz KNOWLEDGE / CONTACTS actualizada.
     */
    async syncFromOTRS() {
      const oficiales = await loadFromKnowledgeStorage();
      const manuales = getManualTecnicos();
      return mergeTecnicos(oficiales, manuales);
    },

    /**
     * Purga la caché local de técnicos oficiales (mantiene manuales).
     */
    clearCache() {
      try {
        localStorage.removeItem(STORAGE_KEY_OFFICIAL);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch (_) {}
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.remove([STORAGE_KEY_OFFICIAL, LEGACY_STORAGE_KEY]);
        }
      } catch (_) {}
    }
  };
})();
