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
    $form.find('[name="tcampo"]').val(info['¿Quién Gestiona?'] || '');
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

    /**
     * @description Carga y cachea las opciones del campo dinámico de partes (DynamicField_PARTESNOBUSES)
     * desde el formulario de cierre de OTOBO (AgentTicketClose). Intenta parseo vía DOM primero y
     * recurre al formulario JSON como alternativa. Deduplica las opciones y las inserta en el `$select` recibido.
     *
     * @param {jQuery} $select - Elemento `<select>` de jQuery donde se cargarán las opciones de partes.
     *
     * @returns {Promise<void>}
     */
    const cargarOpcionesParte = async ($select) => {
        try {
            if (!partesOptionsCache || partesOptionsCache.length === 0) {
                partesOptionsCache = [];
                
                // Carga optimizada y unificada desde OTOBO (DOM con fallback a Form)
                try {
                    const dom = await Salem.otrs.ajax({ 
                        Action: 'AgentTicketClose', 
                        TicketID: info.id, 
                        transform: 'dom' 
                    });
                    const $dom = $(dom);
                    const $options = $dom.find('#DynamicField_PARTESNOBUSES1 option, #DynamicField_PARTESNOBUSES option');
                    
                    $options.each(function () {
                        const value = $(this).attr('value') || '';
                        const text = $(this).text().trim();
                        if (value && value !== '-') {
                            partesOptionsCache.push({ value, text });
                        }
                    });
                } catch (domErr) {
                    console.warn('[SALEM][CLOSE] Fallback a form para opciones de parte:', domErr);
                    const formData = await Salem.otrs.ajax({ 
                        Action: 'AgentTicketClose', 
                        TicketID: info.id, 
                        transform: 'form' 
                    });
                    
                    if (formData) {
                        Object.keys(formData).forEach(key => {
                            if (/^DynamicField_PARTESNOBUSES\d*\.Option$/.test(key)) {
                                const options = formData[key];
                                Object.entries(options).forEach(([value, text]) => {
                                    if (value && value !== '-') {
                                        partesOptionsCache.push({ value, text });
                                    }
                                });
                            }
                        });
                    }
                }

                // Deduplicar opciones
                const seen = new Set();
                partesOptionsCache = partesOptionsCache.filter(opt => {
                    if (seen.has(opt.value)) return false;
                    seen.add(opt.value);
                    return true;
                });
            }

            // Poblar el select
            $select.empty();
            $select.append('<option value="" disabled selected>Seleccione una parte</option>');
            partesOptionsCache.forEach(opt => {
                $select.append(`<option value="${opt.value}">${opt.text}</option>`);
            });

        } catch (error) {
            console.error('[SALEM][CLOSE] Error al cargar opciones de partes:', error);
            $select.empty();
            $select.append('<option value="" disabled selected>Error al cargar opciones</option>');
        }
    };

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

        /**
         * @description Clona la plantilla HTML de parte, asigna nombres de campo dinámicos indexados
         * (`DynamicField_PARTESNOBUSESn`, `DynamicField_SERIALINSTALADOn`, etc.),
         * la añade con animación fadeIn a la lista de partes y carga sus opciones desde OTOBO.
         *
         * @returns {Promise<void>}
         */
        const agregarNuevaParte = async () => {
            const cantidadPartes = $listaPartes.children('.parte-item').length;
            const nuevoIndex = cantidadPartes + 1;
            
            const $template = $('#parteTemplate');
            const $nuevaParte = $template.clone();
            
            $nuevaParte.attr('id', '');
            $nuevaParte.addClass('parte-item');
            $nuevaParte.attr('data-index', nuevoIndex);
            $nuevaParte.removeClass('d-none');
            
            $nuevaParte.find('[data-field="parte"]').attr('name', `DynamicField_PARTESNOBUSES${nuevoIndex}`);
            $nuevaParte.find('[data-field="serial-instalado"]').attr('name', `DynamicField_SERIALINSTALADO${nuevoIndex}`);
            $nuevaParte.find('[data-field="serial-retirado"]').attr('name', `DynamicField_SERIALRETIRADO${nuevoIndex}`);
            $nuevaParte.find('[data-field="exists"]').attr('name', `ExistsDynamicField_PARTESNOBUSES${nuevoIndex}`);
            
            $nuevaParte.hide();
            $listaPartes.append($nuevaParte);
            $nuevaParte.fadeIn(300);
            
            await cargarOpcionesParte($nuevaParte.find('[data-field="parte"]'));
        };

        $btnAddParte.on('click', agregarNuevaParte);

        $(document).on('click', '.btnRemoveParte', function () {
            const $item = $(this).closest('.parte-item');
            $item.fadeOut(300, function() {
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
            $listaPartes.find('.parte-item').each(function (idx) {
                const index = idx + 1;
                const parte = $(this).find(`[name="DynamicField_PARTESNOBUSES${index}"]`).val();
                const serialIn = $(this).find(`[name="DynamicField_SERIALINSTALADO${index}"]`).val();
                const serialOut = $(this).find(`[name="DynamicField_SERIALRETIRADO${index}"]`).val();
                
                if (parte) {
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
