(async () => {
    // ========== INICIALIZACIÓN DE VARIABLES ==========
    const info = await Salem.core.runtime.getInfo();
    const idEquipo = info['ID Móvil'] || info['ID Equipo'];
    const ubicacion = info.Patio || info['Estación'] || info['Ubicación Infraestructura Física y Locativa'] || info['Ubicación Punto de Personalización']
    
    // Verificar si el rótulo incluye "CAMBIO DE PARTE"
    const includesCambioParte = info.rotulo?.includes('CAMBIO DE PARTE')
    
    // Determinar tipo de falla
    const falla = includesCambioParte 
        ? 'ATENCION A SOLICITUD' 
        : info['Requerimiento de Soporte Técnico']?.includes('RUTINARIO') 
            ? 'EJECUCION DE MANTENIMIENTO RUTINARIO' 
            : 'EJECUCION DE MANTENIMIENTO PREVENTIVO';
    
    const closeParams = storage.config.otrs.CLOSE.find(u => u.servicio === info.Servicio && u.falla === falla)

    // ========== POBLAR FORMULARIO ==========
    const $form = $('form#closeTickets')
    $form.find('[name="rotulo"]').val(info.rotulo)
    $form.find('[name="equipo"]').val(idEquipo)
    $form.find('[name="ubicacion"]').val(ubicacion)
    $form.find('[name="tcampo"]').val(info['¿Quién Gestiona?'])
    $form.find('[name="falla"]').val(falla)

    // ========== OCULTAR/MOSTRAR CAMPOS SEGÚN CAMBIO DE PARTE ==========
    const $adjuntosContainer = $('.file-upload-section')
    const $cambioParteContainer = $('select[name="parte"]').closest('.mt-4')
    
    if (!includesCambioParte) {
        // Ocultar campos si NO es cambio de parte
        $adjuntosContainer.hide()
        $cambioParteContainer.hide()
        
        // Remover el atributo required de los campos ocultos
        $adjuntosContainer.find('input[type="file"]').prop('required', false)
        $cambioParteContainer.find('select[name="parte"]').prop('required', false)
    } else {
        // Mostrar campos si SÍ es cambio de parte
        $adjuntosContainer.show()
        $cambioParteContainer.show()
    }

    // Inicializar editor
    const closeEditor = await ClassicEditor.create($('#closeEditor')[0], { 
        placeholder: 'Ingrese la plantilla del técnico aquí.' 
    })

    // ========== GESTIÓN DE EVIDENCIAS ==========
    let attachNew = []
    let attachThis = []
    const fileInput = $('input[type="file"][multiple]')
    
    // Event listener para archivos adjuntos (solo funciona si está visible)
    if (includesCambioParte) {
        fileInput.on("change", e => {
            attachNew = []
            attachThis = []
            Array.from(e.target.files).forEach(file => {
                attachNew.push(file)
                attachThis.push(file)
            })
        })
    }

    // ========== GESTIÓN DE CAMBIO DE PARTES ==========
    const $partesWrapper = $('#partesWrapper');
    const $btnAddParte = $('#btnAddParte');
    const $listaPartes = $('#listaPartes');
    let partesOptionsCache = null

    const cargarOpcionesParte = async ($select) => {
        try {
            if (!partesOptionsCache || partesOptionsCache.length === 0) {
                partesOptionsCache = []
                
                // Intento 1: Cargar desde DOM
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
                } catch (e) {
                    console.warn('No se pudo cargar opciones desde DOM:', e);
                }

                // Intento 2: Cargar desde JSON
                if (partesOptionsCache.length === 0) {
                    try {
                        const formData = await Salem.otrs.ajax({ 
                            Action: 'AgentTicketClose', 
                            TicketID: info.id, 
                            transform: 'form' 
                        });
                        
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
                        
                        // Eliminar duplicados
                        const seen = new Set();
                        partesOptionsCache = partesOptionsCache.filter(opt => {
                            if (seen.has(opt.value)) return false;
                            seen.add(opt.value);
                            return true;
                        });
                    } catch (e) {
                        console.warn('No se pudo cargar opciones desde JSON:', e);
                    }
                }
            }

            // Poblar el select
            $select.empty();
            $select.append('<option value="" disabled selected>Seleccione una parte</option>');
            partesOptionsCache.forEach(opt => {
                $select.append(`<option value="${opt.value}">${opt.text}</option>`);
            });

        } catch (error) {
            console.error('Error al cargar opciones de partes:', error);
            $select.empty();
            $select.append('<option value="" disabled selected>Error al cargar opciones</option>');
        }
    };

    // Mostrar/ocultar sección de partes (solo si includesCambioParte es true)
    if (includesCambioParte) {
        $(document).on('change', 'select[name="parte"]', async function () {
            const valor = $(this).val();
            
            if (valor === 'SI') {
                $partesWrapper.removeClass('d-none').hide().fadeIn(300);
                
                // Si no hay partes, agregar la primera
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
    }

    // Agregar nueva parte
    const agregarNuevaParte = async () => {
        const cantidadPartes = $listaPartes.children('.parte-item').length;
        const nuevoIndex = cantidadPartes + 1;
        
        // Clonar el template
        const $template = $('#parteTemplate');
        const $nuevaParte = $template.clone();
        
        // Actualizar atributos e IDs
        $nuevaParte.attr('id', '');
        $nuevaParte.addClass('parte-item');
        $nuevaParte.attr('data-index', nuevoIndex);
        $nuevaParte.removeClass('d-none');
        
        // Actualizar nombres de campos
        $nuevaParte.find('[data-field="parte"]').attr('name', `DynamicField_PARTESNOBUSES${nuevoIndex}`);
        $nuevaParte.find('[data-field="serial-instalado"]').attr('name', `DynamicField_SERIALINSTALADO${nuevoIndex}`);
        $nuevaParte.find('[data-field="serial-retirado"]').attr('name', `DynamicField_SERIALRETIRADO${nuevoIndex}`);
        $nuevaParte.find('[data-field="exists"]').attr('name', `ExistsDynamicField_PARTESNOBUSES${nuevoIndex}`);
        
        // Agregar al contenedor con animación
        $nuevaParte.hide();
        $listaPartes.append($nuevaParte);
        $nuevaParte.fadeIn(300);
        
        // Cargar opciones
        await cargarOpcionesParte($nuevaParte.find('[data-field="parte"]'));
    };

    if (includesCambioParte) {
        $btnAddParte.on('click', agregarNuevaParte);

        // Quitar parte
        $(document).on('click', '.btnRemoveParte', function () {
            const $item = $(this).closest('.parte-item');
            $item.fadeOut(300, function() {
                $(this).remove();
            });
        });
    }

    // ========== ENVÍO DEL FORMULARIO ==========
    $form.submit(async (e) => {
        e.preventDefault();
        
        const data = Salem.utils.getFormValues(e);
        data.cuerpo = closeEditor.getData();

        // Validar contenido mínimo
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

        const closeForm = await Salem.otrs.ajax({ 
            Action: 'AgentTicketClose', 
            TicketID: info.id, 
            transform: 'form' 
        });

        const asunto = `RESUELTO ${data.hora}`;

        // Construir campos de partes (solo si includesCambioParte)
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

        const completeForm = Salem.otrs.utils.predef.close.estaciones(
            closeForm,
            { 
                ...data, 
                firma: storage.login.firma, 
                asunto, 
                atencion: 'PRESENCIAL', 
                original 
            },
            closeParams
        );

        // Adjuntar archivos si existen (solo si includesCambioParte)
        if (includesCambioParte && attachThis.length > 0) {
            for (let i = 0; i < attachThis.length; i++) {
                const file = attachThis[i];
                await Salem.otrs.attach([file], completeForm, [{ name: file.name }]);
            }
            completeForm.AttachmentExists = 1;
        }

        try {
            if (data.falla === 'ATENCION A SOLICITUD') {
                completeForm.NewStateID = '33';
                await Salem.otrs.ajax(completeForm);
                
                const middleware = await Salem.otrs.middleware({ isState: 'RESUELTO' });
                if (middleware) {
                    await Salem.core.runtime.reload();
                    window.close();
                }
            } else {
                await Salem.otrs.ajax(completeForm);
                
                const middleware = await Salem.otrs.middleware({ isState: 'RESUELTO' });
                if (middleware) {
                    await Salem.utils.loading({
                        title: 'Validando por aseguramiento', 
                        message: 'Se está cambiando al estado VALIDADO POR ASEGURAMIENTO.'
                    });
                    
                    completeForm.NewStateID = '42';
                    completeForm.Subject = 'VALIDADO POR ASEGURAMIENTO';
                    completeForm.Body = 'VALIDADO POR ASEGURAMIENTO';
                    delete completeForm.IsVisibleForCustomer;
                    
                    await Salem.otrs.ajax(completeForm);
                    await Salem.core.runtime.reload();
                    window.close();
                }
            }
        } catch (error) {
            console.error('Error al cerrar ticket:', error);
            Salem.utils.toast({ 
                title: 'Error', 
                message: 'Hubo un problema al cerrar el ticket. Intente nuevamente.', 
                type: 'error', 
                noHide: true 
            });
        }
    });
})();