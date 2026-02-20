editorPanel = null
$(() => {
    /**
     * Restaura la CMDB original de estaciones si fue modificada previamente por Fiscalizadores.
     */
    if (storage && storage.config && storage.config.otrs && storage.config.otrs.CMDB_ORIGINAL) {
        storage.config.otrs.CMDB = storage.config.otrs.CMDB_ORIGINAL;
    }

    $('#preventivos [name="modo"]').change(toggleCreateMode)
    /**
 * @description Conmuta el modo de creación (individual o en bloque) e inyecta el script correspondiente.
 *
 * @returns {void}
 */
function toggleCreateMode() {
        if (storage && storage.config && storage.config.otrs && storage.config.otrs.CMDB_ORIGINAL) {
            storage.config.otrs.CMDB = storage.config.otrs.CMDB_ORIGINAL;
        }
        let mode = $(this).val()
        Salem.utils.partials.injectScript(`/sources/popup/menus/planes/create/${mode}.js`)
    }

    $('#preventivos').submit(async e => {
        e.preventDefault()
        let data = Salem.utils.getFormValues(e)
        if (data.progresar && data.progresar == 'SI') {
            data.destino = 'PROGRESO MTTO PREVENTIVO'
            data.nota = editorPanel.getData()
            if (data.nota.length < 10) {
                Salem.utils.toast({ noHide: true, title: 'Faltan datos', message: 'Ha indicado que desea progresar este ticket, pero la nota entregada es muy corta.', type: 'error' })
                return
            }
        }
        else {
            data.destino = 'ASIGNADO A CAMPO'
            data.nota = null
        }
        
        // Resolver los datos de creación para cada ticket.
        let salemPackage = JSON.parse(data.index).map(index => {
            let cmdb = storage.config.otrs.CMDB.find(u => u.index == index)
            cmdb.asunto = `${data.asunto} ${cmdb.equipo} ${cmdb.name} ${cmdb.estacion} ${cmdb.ubicacion}`
            cmdb.cuerpo = cmdb.asunto
            let create = storage.config.otrs.CREATE.find(u => u.equipo == cmdb.equipo && u.requerimiento == 'MANTENIMIENTO PREVENTIVO PROGRAMADO' && u.servicio.includes('ESTACION TRONCAL'))
            return { cmdb, create }
        })

        // Por cada paquete, crear un formulario de OTOBO. Enviar todos al tiempo y con el manejo de hilos hacer la verificación 
        // y asignación de cada uno
        let otrsCheckDuplicity = await checkDuplicity(salemPackage)
        let rowsTable = otrsCheckDuplicity.map(u => {
            return `<tr>
                <td class="d-none">${u.cmdb.index}</td>
                <td>${u.cmdb.equipo}</td>
                <td>${u.cmdb.name}</td>
                <td>${u.cmdb.ubicacion}</td>
                <td>${u.hasDuplicity.length == 0 ? 'NO' : 'SI'}</td>
                <td>${u.hasDuplicity.map(u => u['Ticket Número']).join('<br>')}</td>
                <td>
                    <select class="form-select">
                        <option value="SI" ${u.hasDuplicity.length == 0 ? 'selected' : ''}>SI</option>
                        <option value="NO" ${u.hasDuplicity.length != 0 ? 'selected' : ''}>NO</option>
                    </select>
                </td>
            </tr>`
        })

        let tableStructure = `<table class="table table-sm table-hover" data-table="confirmCreate">
            <thead>
                <th class="d-none">ID</th>
                <th>Equipo</th>
                <th>ID</th>
                <th>Ubicacion</th>
                <th>Duplicidad</th>
                <th>Tickets</th>
                <th>Generar</th>
            </thead>
            <tbody>
                ${rowsTable.join('')}
            </tbody>
        </table>`

        let confirmCreate = tableStructure + `<form id="confirmCreate" class="row"><div class="col-auto">
            <button class="btn btn-primary" type="button" data-action="confirmCreate">
                <i class="fa-solid fa-paper-plane"></i>Confirmar
            </button>
        </div></form>`

        $('[data-tag="sidebar-content"]').html(confirmCreate)
        await Salem.utils.loading()

        $(document).find('[data-action="confirmCreate"]').click(async e => {
            e.preventDefault()
            let filas = $('[data-table="confirmCreate"] tbody tr')
            Array.from(filas).forEach((tr, index) => otrsCheckDuplicity[index].confirm = $(tr).find('select').val())

            let contador = 0
            let note = $(`<table class="table table-sm">
                <thead>
                    <tr>
                        <th>Ticket</th>
                        <th>Asunto</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>`)
            let generados = []
            for (let u of otrsCheckDuplicity) {
                if (u.confirm !== 'SI') {
                    contador++
                    continue
                }

                try {
                    await Salem.utils.loading({ title: 'Conectando con OTOBO', message: 'Se está solicitando un formulario de ticket nuevo' })
                    let form = await Salem.otrs.ajax({ Action: 'AgentTicketPhone1', transform: 'form' })
                    if (!form) {
                        throw new Error(`[preventivos] No se pudo obtener el formulario OTOBO de creación (AgentTicketPhone1) para ${u.cmdb ? u.cmdb.name : 'equipo'}`)
                    }

                    let completeForm = Salem.otrs.utils.predef.create.estaciones(form, u.cmdb, u.create)
                    await Salem.utils.loading({
                        title: `Generando tickets`,
                        message: `<p>Por favor espere mientras se completa la creación de ticket para ${u.cmdb.equipo} ${u.cmdb.name}</p>
                        <p>Generando ticket ${contador + 1} de ${otrsCheckDuplicity.length}</p>`
                    })
                    let nuevoTicket = await Salem.otrs.ajax(completeForm)
                    if (!nuevoTicket || !nuevoTicket.ticket) {
                        throw new Error(`[preventivos] OTOBO no devolvió información válida después de StoreNew para ${u.cmdb ? u.cmdb.name : 'equipo'}`)
                    }

                    let middleware = await Salem.otrs.middleware({ isState: 'NUEVO' }, nuevoTicket)
                    if (middleware) {
                        await Salem.utils.loading({ title: 'Realizando traza', message: 'Realizando traza de estados' })
                        let sweep = await Salem.core.runtime.sweepCreate(nuevoTicket, { firma: storage.login.firma, ...data })
                        if (sweep) {
                            await Salem.otrs.utils.move(nuevoTicket, 'MANTENIMIENTO PREVENTIVO')

                            note.find('tbody').append(`<tr>
                                <td class="is-otrs">${nuevoTicket.ticket}</td>
                                <td>${u.cmdb.asunto} ${u.cmdb.ubicacion}</td>
                                <td class="text-success"><i class="fa-solid fa-circle-check"></i></td>
                            </tr>`)
                            generados.push(nuevoTicket.ticket)

                        }
                        else {
                            note.find('tbody').append(`<tr>
                                <td class="is-otrs">${nuevoTicket.ticket}</td>
                                <td>${u.cmdb.asunto} ${u.cmdb.ubicacion}</td>
                                <td class="text-danger"><i class="fa-solid fa-circle-xmark"></i></td>
                            </tr>`)
                            generados.push(nuevoTicket.ticket)
                        }
                    }
                    else {
                        note.find('tbody').append(`<tr>
                            <td class="text-danger fw-bold"><i class="fa-solid fa-circle-xmark"></i></td>
                            <td>${u.cmdb.asunto} ${u.cmdb.ubicacion}</td>
                            <td class="text-danger fw-bold"><i class="fa-solid fa-circle-xmark"></i></td>
                        </tr>`)
                    }
                } catch (error) {
                    console.error('Salem :: Error en confirmCreate Preventivos', {
                        error,
                        item: u
                    })
                    Salem.utils.toast({
                        title: 'Error en creación',
                        message: error && error.message ? error.message : 'Ocurrió un error inesperado al generar el ticket.',
                        type: 'error',
                        noHide: true
                    })
                    note.find('tbody').append(`<tr>
                        <td class="text-danger fw-bold"><i class="fa-solid fa-circle-xmark"></i></td>
                        <td>${u.cmdb ? `${u.cmdb.asunto} ${u.cmdb.ubicacion}` : 'Error en creación'}</td>
                        <td class="text-danger fw-bold"><i class="fa-solid fa-circle-xmark"></i></td>
                    </tr>`)
                }
                contador++
            }
            await Salem.utils.loading()
            $('[data-tag="sidebar-content"]').html(note)
            for (let ticket of generados) {
                Salem.core.runtime.zoomTicket(ticket)
            }

            if(generados.length == otrsCheckDuplicity.length) window.close()
        })
    })

    $('[name="plan"]').on('change', changePrevType)
})

// Función para cargar automáticamente el plan contractual
/**
 * @description Carga y selecciona automáticamente el plan contractual activo en el formulario de preventivos.
 *
 * @returns {void}
 */
function loadContractualPlan() {
    const planesActive = storage.config.planes.active;
    
    if (planesActive.contractual) {
        const planActivo = planesActive.contractual;
        
        // Seleccionar automáticamente en el dropdown
        $('[name="plan"]').val('contractual');
        
        // Configurar el asunto automáticamente
        $('input[name="asunto"]').val(planActivo);
        
        // Mostrar el contenedor del plan
        $('[data-tag="planContainer"]').removeClass('d-none');
        $('[data-tag="plan"]').text(planActivo);
    }
}

// Modificar tu función changePrevType existente (simplificada)
/**
 * @description Actualiza el asunto y el contenedor visual cuando cambia el tipo de plan preventivo.
 *
 * @returns {void}
 */
function changePrevType() {
    let tipo = $(this).val();
    if (tipo === 'contractual') {
        $('input[name="asunto"]').val(storage.config.planes.active.contractual);
        $('[data-tag="planContainer"]').removeClass('d-none');
        $('[data-tag="plan"]').text(storage.config.planes.active.contractual);
    }
}

// En tu inicialización existente, agregar:
$(() => {
    // Cargar automáticamente el plan contractual
    loadContractualPlan();
    
    // Solo el evento que necesitas
    $('[name="plan"]').on('change', changePrevType);
});

/**
 * @description Verifica la existencia de tickets duplicados en OTOBO para la lista de equipos evaluada.
 *
 * @param {Array<Object>} packageList - Lista de paquetes con datos de la CMDB y parámetros CREATE por cada equipo.
 *
 * @returns {Promise<Array<Object>>} Promesa que resuelve la lista de equipos enriquecida con la propiedad hasDuplicity.
 */
function checkDuplicity(packageList) {
    if (typeof Salem !== 'undefined' && Salem.otrs && Salem.otrs.utils && typeof Salem.otrs.utils.checkDuplicity === 'function') {
        return Salem.otrs.utils.checkDuplicity(packageList, typeof storage !== 'undefined' ? storage : null);
    }
    return new Promise(async resolve => {
        let res = [];
        for (let u of packageList) {
            await Salem.utils.loading({
                title: 'Verificando duplicidad',
                message: `Se está verificando duplicidad para el equipo ${u.cmdb.equipo} ${u.cmdb.name} de ${u.cmdb.estacion}`
            });
            let baseSearch = storage && storage.config && storage.config.utils && storage.config.utils.checkDuplicity;
            let search = baseSearch ? { ...baseSearch } : {};
            search.Search_DynamicField_IDEQUIPO = u.cmdb.name;
            search.Title = `"${u.cmdb.asunto}"`;
            search.ServiceIDs = [u.create.service_id];
            let hasDuplicity = await Salem.otrs.ajax(search);
            res.push({ ...u, hasDuplicity: hasDuplicity || [] });
        }
        resolve(res);
    });
}