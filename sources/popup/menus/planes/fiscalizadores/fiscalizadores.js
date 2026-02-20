editorPanel = null;

$(() => {
    $('#fiscalizadores [name="modo"]').change(toggleCreateMode);

    /**
     * @description Alterna y carga dinámicamente el script de creación de tickets según el modo seleccionado (individual o bloque).
     * Aplica el shim en la CMDB para asegurar que los subpaneles lean la información de FISCALIZADOR respaldando la CMDB original.
     *
     * @returns {void}
     */
    function toggleCreateMode() {
        let mode = $(this).val();
        // Shim para que los scripts compartidos (simple.js / bulk.js) lean los equipos de fiscalizadores
        if (storage && storage.config && storage.config.otrs && storage.config.otrs.CMDB_FISCALIZADOR) {
            if (!storage.config.otrs.CMDB_ORIGINAL) {
                storage.config.otrs.CMDB_ORIGINAL = storage.config.otrs.CMDB;
            }
            storage.config.otrs.CMDB = storage.config.otrs.CMDB_FISCALIZADOR.map((u, idx) => ({
                ...u,
                equipo: u.equipo || 'FISCALIZADOR',
                estacion: u.estacion || u.ubicacion || '',
                index: (typeof u.index !== 'undefined' && u.index !== null) ? u.index : idx,
                name: u.name || u.id || u.id_equipo || u.idequipo || '',
                ubicacion: u.ubicacion || u.estacion || ''
            }));
        }
        Salem.utils.partials.injectScript(`/sources/popup/menus/planes/create/${mode}.js`);
    }

    $('#fiscalizadores').submit(async e => {
        e.preventDefault();
        let data = Salem.utils.getFormValues(e);
        if (data.progresar && data.progresar == 'SI') {
            data.destino = 'PROGRESO MTTO PREVENTIVO';
            data.nota = editorPanel.getData();
            if (data.nota.length < 10) {
                Salem.utils.toast({ noHide: true, title: 'Faltan datos', message: 'Ha indicado que desea progresar este ticket, pero la nota entregada es muy corta.', type: 'error' });
                return;
            }
        } else {
            data.destino = 'ASIGNADO A CAMPO';
            data.nota = null;
        }

        // Resolver los datos de creación para cada ticket desde la CMDB de Fiscalizadores activa
        let cmdbSource = (storage && storage.config && storage.config.otrs && storage.config.otrs.CMDB)
            ? storage.config.otrs.CMDB
            : (storage && storage.config && storage.config.otrs && storage.config.otrs.CMDB_FISCALIZADOR)
                ? storage.config.otrs.CMDB_FISCALIZADOR
                : [];

        let salemPackage = JSON.parse(data.index).map(index => {
            let found = cmdbSource.find(u => u.index == index || u.name == index || u.id == index);
            let cmdb = found ? { ...found } : {};
            cmdb.equipo = cmdb.equipo || 'FISCALIZADOR';
            cmdb.name = cmdb.name || cmdb.id || cmdb.id_equipo || cmdb.idequipo || '';
            cmdb.estacion = cmdb.estacion || cmdb.ubicacion || '';
            cmdb.ubicacion = cmdb.ubicacion || cmdb.estacion || '';
            cmdb.asunto = `${data.asunto} ${cmdb.equipo} ${cmdb.name} ${cmdb.estacion || cmdb.ubicacion || ''}`.trim();
            cmdb.cuerpo = cmdb.asunto;
            let create = storage.config.otrs.CREATE.find(u =>
                (u.equipo || '').trim().toUpperCase() === (cmdb.equipo || '').trim().toUpperCase() &&
                u.requerimiento === 'MANTENIMIENTO PREVENTIVO PROGRAMADO'
            );
            return { cmdb, create };
        });

        // Verificar duplicidad de tickets en OTOBO para el paquete seleccionado
        let otrsCheckDuplicity = await checkDuplicity(salemPackage);
        let rowsTable = otrsCheckDuplicity.map(u => {
            return `<tr>
                <td class="d-none">${u.cmdb.index}</td>
                <td>${u.cmdb.equipo}</td>
                <td>${u.cmdb.name}</td>
                <td>${u.cmdb.ubicacion}</td>
                <td>${u.hasDuplicity.length == 0 ? 'NO' : 'SI'}</td>
                <td>${u.hasDuplicity.map(d => d['Ticket Número']).join('<br>')}</td>
                <td>
                    <select class="form-select">
                        <option value="SI" ${u.hasDuplicity.length == 0 ? 'selected' : ''}>SI</option>
                        <option value="NO" ${u.hasDuplicity.length != 0 ? 'selected' : ''}>NO</option>
                    </select>
                </td>
            </tr>`;
        });

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
        </table>`;

        let confirmCreate = tableStructure + `<form id="confirmCreate" class="row"><div class="col-auto">
            <button class="btn btn-primary" type="button" data-action="confirmCreate">
                <i class="fa-solid fa-paper-plane"></i>Confirmar
            </button>
        </div></form>`;

        $('[data-tag="sidebar-content"]').html(confirmCreate);
        await Salem.utils.loading();

        $(document).find('[data-action="confirmCreate"]').click(async ev => {
            ev.preventDefault();
            let filas = $('[data-table="confirmCreate"] tbody tr');
            Array.from(filas).forEach((tr, index) => otrsCheckDuplicity[index].confirm = $(tr).find('select').val());

            let contador = 0;
            let note = $(`<table class="table table-sm">
                <thead>
                    <tr>
                        <th>Ticket</th>
                        <th>Asunto</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>`);
            let generados = [];

            for (let u of otrsCheckDuplicity) {
                if (u.confirm !== 'SI') {
                    contador++;
                    continue;
                }

                try {
                    await Salem.utils.loading({ title: 'Conectando con OTOBO', message: 'Se está solicitando un formulario de ticket nuevo' });
                    let form = await Salem.otrs.ajax({ Action: 'AgentTicketPhone6', transform: 'form' });
                    if (!form) {
                        throw new Error(`[fiscalizadores] No se pudo obtener el formulario OTOBO de creación (AgentTicketPhone6) para ${u.cmdb ? u.cmdb.name : 'equipo'}`);
                    }

                    let completeForm = Salem.otrs.utils.predef.create.fiscalizador(form, u.cmdb, u.create);
                    await Salem.utils.loading({
                        title: `Generando tickets`,
                        message: `<p>Por favor espere mientras se completa la creación de ticket para ${u.cmdb.equipo} ${u.cmdb.name}</p>
                        <p>Generando ticket ${contador + 1} de ${otrsCheckDuplicity.length}</p>`
                    });
                    let nuevoTicket = await Salem.otrs.ajax(completeForm);
                    if (!nuevoTicket || !nuevoTicket.ticket) {
                        throw new Error(`[fiscalizadores] OTOBO no devolvió información válida después de StoreNew para ${u.cmdb ? u.cmdb.name : 'equipo'}`);
                    }

                    let middleware = await Salem.otrs.middleware({ isState: 'NUEVO' }, nuevoTicket);
                    if (middleware) {
                        await Salem.utils.loading({ title: 'Realizando traza', message: 'Realizando traza de estados' });
                        let sweep = await Salem.core.runtime.sweepFiscalizadores(nuevoTicket, { firma: storage.login.firma, ...data });
                        if (sweep) {

                            note.find('tbody').append(`<tr>
                                <td class="is-otrs">${nuevoTicket.ticket}</td>
                                <td>${u.cmdb.asunto} ${u.cmdb.ubicacion}</td>
                                <td class="text-success"><i class="fa-solid fa-circle-check"></i></td>
                            </tr>`);
                            generados.push(nuevoTicket.ticket);
                        } else {
                            note.find('tbody').append(`<tr>
                                <td class="is-otrs">${nuevoTicket.ticket}</td>
                                <td>${u.cmdb.asunto} ${u.cmdb.ubicacion}</td>
                                <td class="text-danger"><i class="fa-solid fa-circle-xmark"></i></td>
                            </tr>`);
                            generados.push(nuevoTicket.ticket);
                        }
                    } else {
                        note.find('tbody').append(`<tr>
                            <td class="text-danger fw-bold"><i class="fa-solid fa-circle-xmark"></i></td>
                            <td>${u.cmdb.asunto} ${u.cmdb.ubicacion}</td>
                            <td class="text-danger fw-bold"><i class="fa-solid fa-circle-xmark"></i></td>
                        </tr>`);
                    }
                } catch (error) {
                    console.error('Salem :: Error en confirmCreate Fiscalizadores', {
                        error,
                        item: u
                    });
                    Salem.utils.toast({
                        title: 'Error en creación',
                        message: error && error.message ? error.message : 'Ocurrió un error inesperado al generar el ticket de fiscalizador.',
                        type: 'error',
                        noHide: true
                    });
                    note.find('tbody').append(`<tr>
                        <td class="text-danger fw-bold"><i class="fa-solid fa-circle-xmark"></i></td>
                        <td>${u.cmdb ? `${u.cmdb.asunto} ${u.cmdb.ubicacion}` : 'Error en creación'}</td>
                        <td class="text-danger fw-bold"><i class="fa-solid fa-circle-xmark"></i></td>
                    </tr>`);
                }
                contador++;
            }

            await Salem.utils.loading();
            $('[data-tag="sidebar-content"]').html(note);
            for (let ticket of generados) {
                Salem.core.runtime.zoomTicket(ticket);
            }

            if (generados.length == otrsCheckDuplicity.length) window.close();
        });
    });

    $('[name="plan"]').on('change', changePrevType);
});

/**
 * @description Carga y selecciona automáticamente el plan de mantenimiento preventivo activo para Fiscalizadores.
 * Configura los inputs ocultos del formulario y muestra el badge del plan activo.
 *
 * @returns {void}
 */
function loadPlanFiscalizador() {
    const planesActive = storage?.config?.planes?.active;

    if (planesActive && planesActive.fiscalizador) {
        const planActivo = planesActive.fiscalizador;

        // Seleccionar automáticamente en el dropdown
        $('[name="plan"]').val('fiscalizador');

        // Configurar el asunto automáticamente
        $('input[name="asunto"]').val(planActivo);

        // Mostrar el contenedor del plan
        $('[data-tag="planContainer"]').removeClass('d-none');
        $('[data-tag="plan"]').text(planActivo);
    }
}

/**
 * @description Actualiza el asunto y el contenedor informativo del plan cuando el usuario cambia la opción del selector de plan.
 *
 * @returns {void}
 */
function changePrevType() {
    let tipo = $(this).val();
    if (tipo === 'fiscalizador' && storage?.config?.planes?.active?.fiscalizador) {
        let plan = storage.config.planes.active.fiscalizador;
        $('input[name="asunto"]').val(plan);
        $('[data-tag="planContainer"]').removeClass('d-none');
        $('[data-tag="plan"]').text(plan);
    }
}

$(() => {
    // Cargar automáticamente el plan de fiscalizadores al inicializar la vista
    loadPlanFiscalizador();
    $('[name="plan"]').on('change', changePrevType);
});

/**
 * @description Verifica la existencia de tickets duplicados en OTOBO para la lista de equipos evaluada.
 * Delega en Salem.otrs.utils.checkDuplicity si está disponible, o realiza la consulta directa con clonación defensiva.
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
