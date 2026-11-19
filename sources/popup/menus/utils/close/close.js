(async () => {
    // ========== 1. INICIALIZACIÓN DE VARIABLES Y CONTEXTO ==========
    const info = await Salem.core.runtime.getInfo();
    const idEquipo = info['ID Móvil'] || info['ID Equipo'] || info['ID Equipo Centro de Control'] || info['ID Equipo CC'] || info.DynamicField_IDEQUIPO || '';
    const ubicacion = info.Patio || info['Estación'] || info['Ubicación Infraestructura Física y Locativa'] || info['Ubicación Punto de Personalización'] || info['Ubicación Equipo Centro de Control'] || info['Ubicación Equipo CC'] || info['Ubicación Centro de Control'] || info['Ubicación'] || info['Ubicacion'] || info.DynamicField_UBICACIONEQUIPOCC || info.DynamicField_UBICACIONESTACION || (info.rotulo ? info.rotulo.split(' ').pop() : '') || '';
    
    // Verificar si el rótulo incluye "CAMBIO DE PARTE"
    const includesCambioParte = info.rotulo?.includes('CAMBIO DE PARTE');
    
    // Determinar tipo de falla
    const falla = includesCambioParte 
        ? 'ATENCION A SOLICITUD' 
        : info['Requerimiento de Soporte Técnico']?.includes('RUTINARIO') 
            ? 'EJECUCION DE MANTENIMIENTO RUTINARIO' 
            : 'EJECUCION DE MANTENIMIENTO PREVENTIVO';
    
    const closeParams = storage.config.otrs.CLOSE.find(u => u.servicio === info.Servicio && u.falla === falla);

    // ========== 2. POBLAR FORMULARIO Y AUTORRELLENADOS ==========
    const $form = $('form#closeTickets');
    $form.find('[name="rotulo"]').val(info.rotulo || '');
    $form.find('[name="equipo"]').val(idEquipo);
    $form.find('[name="ubicacion"]').val(ubicacion);
    // [FIX P1] Inicializar selector TomSelect de técnicos reutilizando SalemTecnicos
    // El técnico original se fija vía onReady para garantizar que TomSelect ya esté listo.
    const _tecnicoOriginal = String(info['¿Quién Gestiona?'] || '').replace(/\D/g, '').trim();
    (function inicializarSelectorTecnico() {
        const $selectTcampo = $form.find('[name="tcampo"]');
        if (!$selectTcampo.length) return;

        // Si el técnico original existe, pre-cargar una opción inicial para que TomSelect
        // no arranque vacío y la selección no se pierda durante la carga asíncrona.
        // Enriquecer etiqueta con CÉDULA - NOMBRE si ya está en caché local de técnicos.
        if (_tecnicoOriginal) {
            const tecnicoObj = (typeof SalemTecnicos !== 'undefined' && typeof SalemTecnicos.getTecnicos === 'function')
                ? SalemTecnicos.getTecnicos().find(t => t.value === _tecnicoOriginal)
                : null;
            const textoTecnico = tecnicoObj && tecnicoObj.name ? tecnicoObj.name : _tecnicoOriginal;

            $selectTcampo.append(
                $('<option>', { value: _tecnicoOriginal, text: textoTecnico, selected: true })
            );
        }

        SalemTecnicos.init($form, function (ts) {
            // onReady: TomSelect ya está montado. Fijar el técnico original si no fue
            // cambiado por el usuario (el valor actual sigue siendo el pre-cargado o vacío).
            const valorActual = ts.getValue();
            const tecnicoObj = (typeof SalemTecnicos !== 'undefined' && typeof SalemTecnicos.getTecnicos === 'function')
                ? SalemTecnicos.getTecnicos().find(t => t.value === _tecnicoOriginal)
                : null;
            const textoTecnico = tecnicoObj && tecnicoObj.name ? tecnicoObj.name : _tecnicoOriginal;

            if (!valorActual && _tecnicoOriginal) {
                // La opción inicial puede no existir todavía en las opciones de TomSelect;
                // agregarla si falta antes de seleccionarla.
                if (!ts.options[_tecnicoOriginal]) {
                    ts.addOption({ value: _tecnicoOriginal, name: textoTecnico });
                }
                ts.setValue(_tecnicoOriginal, /* silent= */ true);
            } else if (valorActual === _tecnicoOriginal || !valorActual) {
                // Mismo valor pre-cargado → confirmar selección silenciosa.
                if (_tecnicoOriginal) {
                    if (!ts.options[_tecnicoOriginal]) {
                        ts.addOption({ value: _tecnicoOriginal, name: textoTecnico });
                    }
                    ts.setValue(_tecnicoOriginal, /* silent= */ true);
                }
            }
            // Si el usuario ya cambió el valor (valorActual !== _tecnicoOriginal && valorActual),
            // no se sobreescribe: se conserva la selección activa.
        });
    })();
    $form.find('[name="falla"]').val(falla);

    // [REQ 1] Autorrellenado de hora de cierre con hora actual del PC (HH:MM), 100% editable
    const ahora = new Date();
    const horaActual = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
    $form.find('[name="hora"]').val(horaActual);

    // [REQ 2] Control dinámico de Aseguramiento mediante Checkbox / Switch
    const $chkAnular = $('#chkAnular');
    const $inputAseguramiento = $('#inputAseguramiento');
    const $labelAseguramiento = $('#labelAseguramiento');
    const $alertAnulacion = $('#alertAnulacion');
    const $btnSubmit = $form.find('button[type="submit"]');

    // Estado inicial por defecto: NO anulado ("VALIDADO")
    $inputAseguramiento.val('VALIDADO');
    $chkAnular.prop('checked', false);

    // Al alternar el checkbox / switch:
    $chkAnular.on('change', function () {
        const isAnulado = $(this).is(':checked');
        if (isAnulado) {
            // Marcado: pasa a ANULADO POR ASEGURAMIENTO
            $inputAseguramiento.val('ANULADO');
            $labelAseguramiento
                .removeClass('bg-success')
                .addClass('bg-danger')
                .html('<i class="fa-solid fa-ban me-2"></i>ANULADO POR ASEGURAMIENTO');
            $alertAnulacion.removeClass('d-none');
            $btnSubmit
                .removeClass('btn-primary')
                .addClass('btn-danger')
                .html('<i class="fa-solid fa-ban me-2"></i>Anular ticket');
            $form.find('[name="falla"]').val('ANULADO POR ASEGURAMIENTO');
        } else {
            // Desmarcado: vuelve a VALIDADO POR ASEGURAMIENTO
            $inputAseguramiento.val('VALIDADO');
            $labelAseguramiento
                .removeClass('bg-danger')
                .addClass('bg-success')
                .html('<i class="fa-solid fa-circle-check me-2"></i>VALIDADO POR ASEGURAMIENTO');
            $alertAnulacion.addClass('d-none');
            $btnSubmit
                .removeClass('btn-danger')
                .addClass('btn-primary')
                .html('<i class="fa-solid fa-paper-plane me-2"></i>Cerrar ticket');
            $form.find('[name="falla"]').val(falla);
        }
    });

    // ========== 3. SECCIONES CONDICIONALES DE CAMBIO DE PARTE ==========
    const $adjuntosContainer = $('.file-upload-section');
    const $cambioParteContainer = $('.cambio-parte-section');
    
    if (!includesCambioParte) {
        $adjuntosContainer.hide();
        $cambioParteContainer.hide();
        $adjuntosContainer.find('input[type="file"]').prop('required', false);
        $cambioParteContainer.find('select[name="parte"]').prop('required', false);
    } else {
        $adjuntosContainer.show();
        $cambioParteContainer.show();
    }

    // Inicializar editor
    const closeEditor = await ClassicEditor.create($('#closeEditor')[0], { 
        placeholder: 'Ingrese la plantilla del técnico aquí.' 
    });

    // ========== 4. GESTIÓN DE ADJUNTOS / EVIDENCIAS ==========
    let attachThis = [];
    const fileInput = $('input[type="file"][multiple]');
    
    if (includesCambioParte) {
        fileInput.on("change", e => {
            attachThis = Array.from(e.target.files);
        });
    }

    // ========== 5. GESTIÓN DE PARTES REEMPLAZADAS ==========
    const $partesWrapper = $('#partesWrapper');
    const $btnAddParte = $('#btnAddParte');
    const $listaPartes = $('#listaPartes');
    let partesOptionsCache = null;
    // Control de concurrencia y generación para evitar carreras asíncronas y respuestas tardías
    let _partesRequestSeq = 0;
    let _partesLoadingPromise = null;

    /**
     * @description Carga y cachea las opciones reales del campo DynamicField_PARTESNOBUSES
     * desde OTOBO mediante petición directa a AgentTicketClose con transform: 'plain'.
     * Protegido contra respuestas tardías mediante Request ID / Secuencia monotónica.
     *
     * @param {jQuery} $select - Elemento <select> donde se insertarán las opciones.
     * @returns {Promise<void>}
     */
    const cargarOpcionesParte = async ($select) => {
        // Si ya hay caché válida, poblar directamente sin nueva petición.
        if (partesOptionsCache && partesOptionsCache.length > 0) {
            _poblarSelect($select, partesOptionsCache);
            return;
        }

        // Si hay una carga en vuelo, compartir la promesa activa sin duplicar llamadas.
        if (_partesLoadingPromise) {
            try {
                await _partesLoadingPromise;
                if (partesOptionsCache && partesOptionsCache.length > 0) {
                    _poblarSelect($select, partesOptionsCache);
                }
            } catch (_) {
                // El error de la solicitud en curso se gestiona en su propio flujo
            }
            return;
        }

        const myPromise = _cargarOpcionesDesdeOTOBO();
        _partesLoadingPromise = myPromise;

        try {
            const opciones = await myPromise;
            if (opciones && opciones.length > 0) {
                partesOptionsCache = opciones;
                _poblarSelect($select, partesOptionsCache);
            }
        } catch (err) {
            console.error('[SALEM][CLOSE] Error en cargarOpcionesParte:', err);
            const userMsg = err && err.message ? err.message : 'Error al cargar opciones';
            _mostrarErrorSelect($select, userMsg);
        } finally {
            if (_partesLoadingPromise === myPromise) {
                _partesLoadingPromise = null;
            }
        }
    };

    /**
     * Inicializa o reinicializa TomSelect con búsqueda en un <select> de parte.
     * Si ya existe una instancia TomSelect en ese elemento, la destruye primero.
     */
    function _inicializarTomSelectParte($select) {
        const el = $select[0];
        if (!el) return;
        // Destruir instancia previa si existe
        if (el.tomselect) {
            try { el.tomselect.destroy(); } catch (_) {}
        }
        try {
            new TomSelect(el, {
                placeholder: 'Buscar parte...',
                plugins: ['dropdown_input'],
                maxOptions: null,
                searchField: ['text'],
                sortField: [{ field: 'text', direction: 'asc' }],
                render: {
                    no_results: function () {
                        return '<div class="no-results">Sin resultados</div>';
                    }
                }
            });
        } catch (e) {
            console.warn('[SALEM][CLOSE] TomSelect parte no disponible, usando select nativo.', e);
        }
    }

    /** Puebla un <select> con las opciones cacheadas e inicializa TomSelect con buscador. */
    function _poblarSelect($select, opciones) {
        // Destruir TomSelect previo antes de modificar el <select> nativo
        const el = $select[0];
        if (el && el.tomselect) {
            try { el.tomselect.destroy(); } catch (_) {}
        }
        $select.empty();
        if (!opciones || opciones.length === 0) {
            _mostrarErrorSelect($select, 'No se encontraron partes disponibles');
            return;
        }
        $select.append($('<option>', { value: '', text: 'Seleccione una parte', disabled: true, selected: true }));
        opciones.forEach(opt => {
            $select.append($('<option>', { value: opt.value, text: opt.text }));
        });
        // Montar TomSelect con búsqueda sobre el select ya poblado
        _inicializarTomSelectParte($select);
    }

    /** Muestra un mensaje informativo o de error en el <select>. */
    function _mostrarErrorSelect($select, msg) {
        const el = $select[0];
        if (el && el.tomselect) {
            try { el.tomselect.destroy(); } catch (_) {}
        }
        $select.empty();
        $select.append($('<option>', { value: '', text: msg, disabled: true, selected: true }));
    }

    /**
     * Envuelve una promesa con un timeout de seguridad y cancela el timer con clearTimeout
     * para evitar temporizadores pendientes innecesarios en el event loop.
     * @param {Promise} promise
     * @param {number} ms
     * @param {string} label
     * @returns {Promise}
     */
    function _promesaConTimeout(promise, ms, label) {
        let timer = null;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error(`Tiempo de espera agotado (${label})`));
            }, ms);
        });

        return Promise.race([
            Promise.resolve(promise),
            timeoutPromise
        ]).finally(() => {
            if (timer) clearTimeout(timer);
        });
    }

    /**
     * Interpreta la respuesta sin procesar de OTOBO (HTML o JSON de compatibilidad):
     * - HTML: Parseo vía DOMParser buscando selects de PARTESNOBUSES, descartando vacíos y '-'.
     *   Detecta errores solo en contenedores visibles (.Error, .ErrorMessage, .MessageBox.Error).
     *   Detecta login solo en inputs de login o título.
     *   NO contiene ninguna regla de challenge token que genere falsos positivos.
     * - JSON: Soporta tuplas [val, text, ...] u objetos { val: text }.
     *
     * @param {string|object} rawResponse
     * @returns {{ opciones: Array<{value:string, text:string}>, errorMsg: string|null }}
     */
    function _interpretarRespuestaOTOBO(rawResponse) {
        if (!rawResponse) {
            return { opciones: [], errorMsg: 'Respuesta vacía del servidor OTOBO.' };
        }

        let opciones = [];

        // ── 1. Bloque JSON de compatibilidad (solo si inicia con { o [ o es un objeto) ──
        let parsedJson = null;
        if (typeof rawResponse === 'object' && rawResponse !== null) {
            parsedJson = rawResponse;
        } else if (typeof rawResponse === 'string') {
            const trimmed = rawResponse.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                    parsedJson = JSON.parse(trimmed);
                } catch (_) {
                    // No es JSON válido; continuará al análisis HTML
                }
            }
        }

        if (parsedJson) {
            let targetData = null;
            if (Array.isArray(parsedJson)) {
                const found = parsedJson.find(it => it && typeof it === 'object' && (
                    it.Name === 'DynamicField_PARTESNOBUSES' ||
                    /^DynamicField_PARTESNOBUSES\d*$/i.test(it.Name || it.name || '')
                ));
                if (found && found.Data) {
                    targetData = found.Data;
                }
            } else if (typeof parsedJson === 'object') {
                const targetKey = Object.keys(parsedJson).find(k =>
                    k === 'DynamicField_PARTESNOBUSES' ||
                    /^DynamicField_PARTESNOBUSES\d*$/i.test(k)
                );
                if (targetKey) {
                    targetData = parsedJson[targetKey];
                }
            }

            if (targetData) {
                if (Array.isArray(targetData)) {
                    targetData.forEach(entry => {
                        let val = '';
                        let txt = '';
                        if (Array.isArray(entry)) {
                            val = entry[0] !== undefined && entry[0] !== null ? String(entry[0]).trim() : '';
                            txt = entry[1] !== undefined && entry[1] !== null ? String(entry[1]).trim() : val;
                        } else if (entry && typeof entry === 'object') {
                            val = String(entry.value || entry.Key || entry.Name || entry.val || '').trim();
                            txt = String(entry.text || entry.Value || entry.Data || entry.txt || val).trim();
                        }
                        if (val && val !== '-' && val !== '' && txt && txt !== '-') {
                            opciones.push({ value: val, text: txt });
                        }
                    });
                } else if (typeof targetData === 'object' && targetData !== null) {
                    Object.entries(targetData).forEach(([k, v]) => {
                        const val = String(k || '').trim();
                        let txt = '';
                        if (typeof v === 'string' || typeof v === 'number') {
                            txt = String(v).trim();
                        } else if (Array.isArray(v)) {
                            txt = String(v[1] || v[0] || val).trim();
                        } else if (v && typeof v === 'object') {
                            txt = String(v.text || v.Value || v.Data || val).trim();
                        } else {
                            txt = val;
                        }

                        if (val && val !== '-' && val !== '' && txt && txt !== '-') {
                            opciones.push({ value: val, text: txt });
                        }
                    });
                }
            }

            if (opciones.length > 0) {
                const seen = new Set();
                opciones = opciones.filter(opt => {
                    if (seen.has(opt.value)) return false;
                    seen.add(opt.value);
                    return true;
                });
                return { opciones, errorMsg: null };
            }
        }

        // ── 2. Análisis HTML vía DOMParser (Flujo nativo de OTOBO) ─────────────
        if (typeof rawResponse === 'string') {
            let doc = null;
            if (typeof DOMParser !== 'undefined') {
                try {
                    doc = new DOMParser().parseFromString(rawResponse, 'text/html');
                } catch (pErr) {
                    console.warn('[SALEM][CLOSE] DOMParser error:', pErr);
                }
            }

            if (doc) {
                // Detección controlada de sesión expirada / login
                const isLoginPage = doc.querySelector('input[name="User"], input[name="Password"], #LoginBox') !== null ||
                                    /iniciar sesión|login/i.test(doc.title || '');
                if (isLoginPage) {
                    return { opciones: [], errorMsg: 'Sesión expirada en OTOBO. Recargue la pestaña.' };
                }

                // Detección de error REAL ÚNICAMENTE en contenedores visibles de error de OTOBO
                const errorBox = doc.querySelector('.Error, .ErrorMessage, .MessageBox.Error');
                if (errorBox) {
                    const errTxt = (errorBox.textContent || '').trim();
                    if (errTxt) {
                        return { opciones: [], errorMsg: errTxt };
                    }
                }

                // Extracción de opciones del selector de partes
                const selects = doc.querySelectorAll(
                    'select#DynamicField_PARTESNOBUSES1, select#DynamicField_PARTESNOBUSES, select[id^="DynamicField_PARTESNOBUSES"], select[name^="DynamicField_PARTESNOBUSES"]'
                );

                if (selects && selects.length > 0) {
                    selects.forEach(selectPartes => {
                        const optElements = selectPartes.querySelectorAll('option');
                        optElements.forEach(opt => {
                            const val = (opt.getAttribute('value') || '').trim();
                            const txt = (opt.textContent || '').trim();
                            if (val && val !== '-' && val !== '' && txt && txt !== '-') {
                                opciones.push({ value: val, text: txt || val });
                            }
                        });
                    });

                    if (opciones.length > 0) {
                        const seen = new Set();
                        opciones = opciones.filter(opt => {
                            if (seen.has(opt.value)) return false;
                            seen.add(opt.value);
                            return true;
                        });
                        return { opciones, errorMsg: null };
                    }
                }
            }
        }

        return { opciones: [], errorMsg: 'Ninguna fuente devolvió opciones para PARTESNOBUSES.' };
    }

    /**
     * Realiza la consulta directa a OTOBO (AgentTicketClose) en texto plano (transform: 'plain')
     * e interpreta la respuesta (HTML o JSON de respaldo).
     * Controlado por seq monotónico para ignorar respuestas tardías u obsoletas.
     *
     * @returns {Promise<Array<{value:string, text:string}>>}
     */
    async function _cargarOpcionesDesdeOTOBO() {
        const reqId = ++_partesRequestSeq;

        let rawResponse = null;
        try {
            rawResponse = await _promesaConTimeout(
                Salem.otrs.ajax({
                    Action: 'AgentTicketClose',
                    TicketID: info.id,
                    transform: 'plain'
                }),
                8000,
                'AgentTicketClose'
            );
        } catch (ajaxErr) {
            console.warn('[SALEM][CLOSE] Petición AgentTicketClose falló o timeout:', ajaxErr);
            throw ajaxErr;
        }

        // Verificar secuencia antes de procesar o guardar
        if (reqId !== _partesRequestSeq) {
            return [];
        }

        const resultado = _interpretarRespuestaOTOBO(rawResponse);
        const opciones = resultado.opciones || [];

        // Verificar nuevamente la secuencia antes de retornar
        if (reqId !== _partesRequestSeq) {
            return [];
        }

        if (opciones.length > 0) {
            console.info(`[SALEM][CLOSE] Catálogo de partes cargado exitosamente (seq ${reqId}): ${opciones.length} opciones.`);
            return opciones;
        } else {
            const msg = resultado.errorMsg || 'Ninguna fuente devolvió opciones para PARTESNOBUSES.';
            console.error('[SALEM][CLOSE]', msg);
            throw new Error(msg);
        }
    }

    if (includesCambioParte) {
        $(document).on('change', 'select[name="parte"]', async function () {
            const valor = $(this).val();
            if (valor === 'SI') {
                $partesWrapper.removeClass('d-none').hide().fadeIn(300);
                if ($listaPartes.children('.parte-item').length === 0) {
                    agregarNuevaParte();
                }
            } else {
                $partesWrapper.fadeOut(300, function() {
                    $(this).addClass('d-none');
                    $listaPartes.empty();
                });
            }
        });

        // [FIX P2-B] Contador global de partes. Se incrementa siempre hacia adelante
        // para garantizar data-uid únicos aunque se eliminen elementos intermedios.
        let _parteUidCounter = 0;

        /**
         * @description Clona la plantilla HTML de parte, asigna un data-uid único e irrepetible
         * (independiente de la posición DOM), la añade con animación fadeIn y carga sus opciones.
         * Los nombres de campo OTOBO se normalizan justo antes del envío, NO aquí.
         *
         * @returns {Promise<void>}
         */
        const agregarNuevaParte = async () => {
            _parteUidCounter++;
            const uid = _parteUidCounter;

            const $template = $('#parteTemplate');
            const $nuevaParte = $template.clone();

            $nuevaParte.attr('id', '');
            $nuevaParte.addClass('parte-item');
            // data-uid: identificador permanente; data-index se asignará en el payload.
            $nuevaParte.attr('data-uid', uid);
            $nuevaParte.removeClass('d-none');

            // Usar nombres temporales con el uid para que jQuery pueda encontrar los
            // campos dentro de ESTE elemento sin colisionar con otros.
            $nuevaParte.find('[data-field="parte"]').attr('name', `_parte_uid_${uid}`);
            $nuevaParte.find('[data-field="serial-instalado"]').attr('name', `_serialin_uid_${uid}`);
            $nuevaParte.find('[data-field="serial-retirado"]').attr('name', `_serialout_uid_${uid}`);
            $nuevaParte.find('[data-field="exists"]').attr('name', `_exists_uid_${uid}`);

            $nuevaParte.hide();
            $listaPartes.append($nuevaParte);
            $nuevaParte.fadeIn(300);

            await cargarOpcionesParte($nuevaParte.find('[data-field="parte"]'));
        };

        $btnAddParte.on('click', agregarNuevaParte);

        $(document).on('click', '.btnRemoveParte', function () {
            const $item = $(this).closest('.parte-item');
            // Destruir instancia TomSelect antes de remover el elemento del DOM
            const selectEl = $item.find('[data-field="parte"]')[0];
            if (selectEl && selectEl.tomselect) {
                try { selectEl.tomselect.destroy(); } catch (_) {}
            }
            $item.removeClass('parte-item').fadeOut(300, function () {
                $(this).remove();
            });
        });
    }

    // ========== 6. UTILIDAD LOCAL STORAGE POST-ANULACIÓN ==========
    /**
     * @description Actualiza el estado del ticket en `localStorage` y en `chrome.storage.local`
     * para reflejar de forma inmediata el cambio de estado (ej. 'ANULADO POR ASEGURAMIENTO')
     * sin esperar una resincronización completa desde el backend.
     *
     * @param {string} ticketNumber - Número o identificador del ticket a actualizar.
     * @param {string} nuevoEstado  - Nuevo estado a asignar al ticket en las colas locales.
     *
     * @returns {void}
     */
    function updateLocalTicketState(ticketNumber, nuevoEstado) {
        if (!ticketNumber) return;
        const targetKeys = ['abiertosEstaciones.json', 'abiertosEstaciones', 'queues.json', 'queues', 'salem_queue'];
        
        targetKeys.forEach(k => {
            try {
                const raw = localStorage.getItem(k);
                if (raw) {
                    let parsed = JSON.parse(raw);
                    let changed = false;
                    if (Array.isArray(parsed)) {
                        parsed = parsed.map(item => {
                            if (item && (item.ticket === ticketNumber || item.TicketNumber === ticketNumber || item.id === ticketNumber)) {
                                item.estado = nuevoEstado;
                                item.Estado = nuevoEstado;
                                item.status = nuevoEstado;
                                changed = true;
                            }
                            return item;
                        });
                        if (changed) localStorage.setItem(k, JSON.stringify(parsed));
                    }
                }
            } catch (_) {}
        });

        // Replicar en chrome.storage.local
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['abiertosEstaciones', 'queues', 'salem_queue'], (res) => {
                    if (!res) return;
                    const updates = {};
                    ['abiertosEstaciones', 'queues', 'salem_queue'].forEach(k => {
                        if (Array.isArray(res[k])) {
                            let mod = false;
                            const items = res[k].map(item => {
                                if (item && (item.ticket === ticketNumber || item.TicketNumber === ticketNumber || item.id === ticketNumber)) {
                                    item.estado = nuevoEstado;
                                    item.status = nuevoEstado;
                                    mod = true;
                                }
                                return item;
                            });
                            if (mod) updates[k] = items;
                        }
                    });
                    if (Object.keys(updates).length > 0) chrome.storage.local.set(updates);
                });
            }
        } catch (_) {}
    }

    // ========== 7. ENVÍO Y PROCESAMIENTO ATÓMICO DEL FORMULARIO ==========
    $form.submit(async (e) => {
        e.preventDefault();
        
        const data = Salem.utils.getFormValues(e);
        data.cuerpo = closeEditor.getData();

        // Validar contenido mínimo de nota
        if (data.cuerpo.length < 10) {
            Salem.utils.toast({ 
                title: 'Nota de cierre incompleta', 
                message: 'El texto ingresado es muy corto.', 
                type: 'error', 
                noHide: true 
            });
            return;
        }

        await Salem.utils.loading({
            title: 'Resolviendo ticket', 
            message: 'Por favor espere mientras se cierra este ticket.'
        });

        let closeDom = null;
        let closeForm = null;
        try {
            closeDom = await Salem.otrs.ajax({ 
                Action: 'AgentTicketClose', 
                TicketID: info.id, 
                transform: 'dom' 
            });
            closeForm = Salem.utils.getFormValues(closeDom, 'dom');
        } catch (domErr) {
            console.warn('[SALEM][CLOSE] Fallback a transform:form para closeForm:', domErr);
            closeForm = await Salem.otrs.ajax({ 
                Action: 'AgentTicketClose', 
                TicketID: info.id, 
                transform: 'form' 
            });
        }

        const asunto = `RESUELTO ${data.hora}`;
        const isAnulado = data.aseguramiento === 'ANULADO';

        // Construir campos de partes
        const original = {};
        if (includesCambioParte && data.parte === 'SI') {
            // [FIX P2-B] Construir payload de partes con índices CONSECUTIVOS normalizados.
            // Se leen los valores usando data-field (no por nombre indexado), lo que garantiza
            // que eliminar una parte intermedia no rompa la lectura de las restantes.
            // La renumeración 1,2,3... se hace aquí, justo antes de construir el objeto,
            // para cumplir con el requisito de OTOBO de índices contiguos.
            const parteItems = $listaPartes.find('.parte-item').toArray();
            let consecutiveIndex = 0;
            parteItems.forEach(function (el) {
                const $el = $(el);
                const parte = $el.find('[data-field="parte"]').val();
                const serialIn = $el.find('[data-field="serial-instalado"]').val();
                const serialOut = $el.find('[data-field="serial-retirado"]').val();

                if (parte) {
                    consecutiveIndex++;
                    const index = consecutiveIndex;
                    original[`ExistsDynamicField_PARTESNOBUSES${index}`] = '1';
                    original[`DynamicField_PARTESNOBUSES${index}`] = parte;
                    if (serialIn) original[`DynamicField_SERIALINSTALADO${index}`] = serialIn;
                    if (serialOut) original[`DynamicField_SERIALRETIRADO${index}`] = serialOut;
                }
            });
        }

        // Si se seleccionó anular ticket por aseguramiento, ajustar Tipo a EVENTO y Tipo de Falla
        let activeCloseParams = closeParams;
        if (isAnulado) {
            let eventoTypeId = null;

            // 1. Detección dinámica en el DOM de AgentTicketClose (select TypeID)
            if (closeDom) {
                const $dom = $(closeDom);
                $dom.find('select[name="TypeID"] option, #TypeID option, select[name*="Type"] option, select[id*="Type"] option').each(function () {
                    const text = $(this).text().trim().toUpperCase();
                    const val = $(this).attr('value');
                    if (val && (text === 'EVENTO' || text.includes('EVENTO'))) {
                        eventoTypeId = val;
                        return false;
                    }
                });
            }

            // 2. Fallback a configuración persistente de OTOBO (hoja CLOE en storage)
            if (!eventoTypeId && storage && storage.config && storage.config.otrs) {
                const buscarEvento = (lista) => {
                    if (!Array.isArray(lista)) return null;
                    const encontrado = lista.find(item => 
                        (item.tipo && item.tipo.toUpperCase().includes('EVENTO')) ||
                        (item.requerimiento && item.requerimiento.toUpperCase().includes('EVENTO')) ||
                        (item.falla && item.falla.toUpperCase().includes('ANULADO'))
                    );
                    return encontrado ? (encontrado.type_id || encontrado.TypeID) : null;
                };
                eventoTypeId = buscarEvento(storage.config.otrs.CLOSE) || buscarEvento(storage.config.otrs.CREATE);
            }

            // 3. Fallback a parámetros específicos de ANULADO si existen en CLOSE
            if (storage && storage.config && storage.config.otrs && Array.isArray(storage.config.otrs.CLOSE)) {
                const anuladoParams = storage.config.otrs.CLOSE.find(u => 
                    u.servicio === info.Servicio && 
                    typeof u.falla === 'string' && 
                    u.falla.toUpperCase().includes('ANULADO')
                ) || storage.config.otrs.CLOSE.find(u => 
                    typeof u.falla === 'string' && 
                    u.falla.toUpperCase().includes('ANULADO')
                );
                if (anuladoParams) {
                    activeCloseParams = { ...closeParams, ...anuladoParams };
                }
            }

            if (eventoTypeId) {
                original.TypeID = eventoTypeId;
            }
            original.DynamicField_TIPOFALLA = 'ANULADO POR ASEGURAMIENTO';
        }

        const completeForm = Salem.otrs.utils.predef.close.estaciones(
            closeForm,
            { 
                ...data, 
                firma: storage.login.firma, 
                asunto, 
                atencion: 'PRESENCIAL', 
                original 
            },
            activeCloseParams
        );

        // Asegurar que completeForm contenga TypeID de EVENTO y Tipo de Falla en caso de anulación
        if (isAnulado) {
            if (original.TypeID) {
                completeForm.TypeID = original.TypeID;
            }
            completeForm.DynamicField_TIPOFALLA = 'ANULADO POR ASEGURAMIENTO';
        }

        // Adjuntar archivos si existen
        if (includesCambioParte && attachThis.length > 0) {
            for (let i = 0; i < attachThis.length; i++) {
                const file = attachThis[i];
                await Salem.otrs.attach([file], completeForm, [{ name: file.name }]);
            }
            completeForm.AttachmentExists = 1;
        }

        try {
            if (data.falla === 'ATENCION A SOLICITUD' && !isAnulado) {
                completeForm.NewStateID = '33';
                await Salem.otrs.ajax(completeForm);
                
                const middleware = await Salem.otrs.middleware({ isState: 'RESUELTO' });
                if (middleware) {
                    await Salem.core.runtime.reload();
                    window.close();
                }
            } else {
                // Primer paso: Cierre a RESUELTO (con Tipo EVENTO y Falla ANULADO POR ASEGURAMIENTO si fue marcado)
                await Salem.otrs.ajax(completeForm);
                
                const middleware = await Salem.otrs.middleware({ isState: 'RESUELTO' });
                if (middleware) {
                    // Transición a VALIDADO POR ASEGURAMIENTO (ID 42) tanto para tickets normales como anulados
                    const targetState = { id: '42', name: 'VALIDADO POR ASEGURAMIENTO', title: 'Validando por aseguramiento' };

                    await Salem.utils.loading({
                        title: targetState.title,
                        message: `Se está cambiando al estado ${targetState.name}.`
                    });

                    // Segundo paso: Transición a VALIDADO POR ASEGURAMIENTO (estado 42)
                    let noteForm = await Salem.otrs.ajax({
                        Action: 'AgentTicketNote',
                        TicketID: info.id,
                        transform: 'form'
                    });

                    if (noteForm) {
                        const noteData = Salem.otrs.utils.predef.notes(noteForm, {
                            firma: storage.login.firma,
                            tcampo: data.tcampo || info['¿Quién Gestiona?'] || storage.login.firma,
                            cuerpo: isAnulado ? 'ANULADO POR ASEGURAMIENTO' : targetState.name,
                            asunto: isAnulado ? 'ANULADO POR ASEGURAMIENTO' : targetState.name,
                            estado: targetState.id,
                            intervencion: 'SI',
                            visible: false
                        });

                        await Salem.otrs.ajax(noteData);
                    }

                    // Validación del segundo POST
                    const middlewareFinal = await Salem.otrs.middleware({ isState: targetState.name });
                    if (middlewareFinal) {
                        const ticketNum = info.ticket || info.TicketNumber || info.id;
                        const nuevoEstadoLocal = isAnulado ? 'ANULADO POR ASEGURAMIENTO' : 'VALIDADO POR ASEGURAMIENTO';

                        // Actualización local y sincronización en bloque protegido con timeout.
                        // Sync y reload corren en paralelo; ninguna puede bloquear el cierre de interfaz.
                        const withTimeout = (promise, ms, label) => Promise.race([
                            Promise.resolve(promise),
                            new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${label}`)), ms))
                        ]);

                        try {
                            updateLocalTicketState(ticketNum, nuevoEstadoLocal);

                            const tasks = [];
                            if (typeof Salem !== 'undefined' && Salem.core && Salem.core.runtime && typeof Salem.core.runtime.sync === 'function') {
                                tasks.push(withTimeout(Salem.core.runtime.sync(), 3000, 'sync'));
                            }
                            if (Salem.core && Salem.core.runtime && typeof Salem.core.runtime.reload === 'function') {
                                tasks.push(withTimeout(Salem.core.runtime.reload(), 3000, 'reload'));
                            }

                            await Promise.allSettled(tasks);
                        } catch (syncErr) {
                            console.warn('[Salem] Sincronización en segundo plano advertencia:', syncErr);
                        } finally {
                            // Cierre de interfaz garantizado: refresca la vista de OTOBO y cierra el popup
                            window.close();
                        }
                    } else {
                        Salem.utils.toast({
                            title: 'Error de transición final',
                            message: `No fue posible confirmar el cambio al estado ${targetState.name}. Verifique el estado del ticket en OTOBO.`,
                            type: 'error',
                            noHide: true
                        });
                    }
                }
            }
        } catch (error) {
            console.error('[SALEM][CLOSE] Error al procesar cierre de ticket:', error);
            Salem.utils.toast({ 
                title: 'Error', 
                message: 'Hubo un problema al cerrar el ticket. Intente nuevamente.', 
                type: 'error', 
                noHide: true 
            });
        }
    });
})();
