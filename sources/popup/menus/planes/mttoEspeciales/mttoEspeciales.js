window.mttoEspecialesModule = {
    init: function () {
        let editorPanel = null
        let idSelector = null

        $(async () => {
            // Inicializar selectores de estaciones
            let estaciones = []
            storage.config.otrs.CMDB.forEach(fila => {
                let match = estaciones.find(u => u.name == fila.estacion)
                if (!match) estaciones.push({ name: fila.estacion })
            })
            estaciones.sort((a, b) => a.name.localeCompare(b.name))

            new TomSelect($('[name="estacion"]')[0], {
                valueField: 'name',
                labelField: 'name',
                searchField: 'name',
                options: estaciones,
                onChange: setEquipos
            })

            // Obtener técnicos disponibles
            await Salem.utils.loading({ title: 'Obteniendo técnicos', message: 'Se está consultando el listado de técnicos disponibles en OTOBO.' })
            let queryAjax = await Salem.otrs.ajax({ Action: 'AgentTicketNote', Subaction: 'AJAXUpdate', ElementChanged: 'DynamicField_QUIENGESTIONA', TicketID: '943890', transform: 'json' })
            let tecnicos = queryAjax.DynamicField_QUIENGESTIONA.map(u => {
                return { name: u[0] }
            })
            new TomSelect($('[name="tcampo"]')[0], {
                valueField: 'name',
                labelField: 'name',
                searchField: 'name',
                options: tecnicos
            })

            // Inicializar el editor siempre
            editorPanel = await ClassicEditor.create($('div#editor')[0], { placeholder: 'Ingrese la plantilla del técnico aquí.' })

            Salem.utils.loading()

            // Función para configurar equipos basado en la estación seleccionada
            function setEquipos() {
                let [estacion] = this.items
                let equipos = storage.config.otrs.CMDB.filter(u => u.estacion == estacion).map(fila => {
                    return { index: fila.index, name: `${fila.equipo} ${fila.name}` }
                })

                // Verificar si existe el parámetro de filtro
                let filtro = $('[name="filtro"]').val()
                if (filtro) equipos = equipos.filter(u => u.name.includes(filtro))

                if (idSelector) idSelector.destroy()
                idSelector = new TomSelect($('[name="id"]')[0], {
                    valueField: 'index',
                    labelField: 'name',
                    searchField: 'name',
                    options: equipos,
                    onChange: setCostado,
                    items: []
                })
                $('[name="index"]').val('')
                $('[name="costado"]').val('')
            }

            // Función para establecer el costado basado en el equipo seleccionado
            function setCostado() {
                let [index] = this.items
                let registro = storage.config.otrs.CMDB.find(u => u.index == index)
                $('[name="costado"]').val(registro.ubicacion)
                $('[name="index"]').val(JSON.stringify(this.items))
            }



            // Manejar envío del formulario
            $('#mttoEspeciales').submit(async e => {
                e.preventDefault()
                let data = Salem.utils.getFormValues(e)

                // Siempre progresar el ticket ya que tenemos editor y hora disponibles
                data.destino = 'ASIGNADO A CAMPO'
                data.cuerpoTicket = editorPanel.getData() // Contenido para el cuerpo del ticket
                data.nota = null // No agregar nota de progreso, solo crear el ticket
                if (data.cuerpoTicket.length < 10) {
                    Salem.utils.toast({ noHide: true, title: 'Faltan datos', message: 'La información del editor es muy corta. Por favor ingrese más información.', type: 'error' })
                    return
                }


                // Resolver los datos de creación para cada ticket.
                let salemPackage = JSON.parse(data.index).map(index => {
                    let cmdb = storage.config.otrs.CMDB.find(u => u.index == index)



                    cmdb.asunto = `CAMBIO DE PARTE ${cmdb.equipo} ${cmdb.name} ${cmdb.estacion} ${cmdb.ubicacion}`
                    cmdb.cuerpo = data.cuerpoTicket // Usar el contenido del editor como cuerpo del ticket
                    let create = storage.config.otrs.CREATE.find(u => u.equipo == cmdb.equipo && u.requerimiento == 'MANTENIMIENTO RUTINARIO' && u.servicio.includes('ESTACION TRONCAL'))
                    return { cmdb, create }
                }).filter(item => item !== null) // Filtrar los elementos null

                // Verificar si quedaron elementos válidos para procesar
                if (salemPackage.length === 0) {
                    Salem.utils.toast({
                        noHide: true,
                        title: 'Sin tickets válidos',
                        message: 'No hay tickets válidos para crear.Estación temporal.',
                        type: 'error'
                    })
                    return; // Salir de la función
                }

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
                        await Salem.utils.loading({ title: 'Conectando con OTOBO', message: 'Se está solicitando un formulario de ticket nuevo' })
                        let form = await Salem.otrs.ajax({ Action: 'AgentTicketPhone1', transform: 'form' })
                        let completeForm = Salem.otrs.utils.predef.create.estaciones(form, u.cmdb, u.create)
                        await Salem.utils.loading({
                            title: `Generando tickets`,
                            message: `<p>Por favor espere mientras se completa la creación de ticket para ${u.cmdb.equipo} ${u.cmdb.name}</p>
                            <p>Generando ticket ${contador + 1} de ${otrsCheckDuplicity.length}</p>`
                        })
                        let nuevoTicket = await Salem.otrs.ajax(completeForm)
                        let middleware = await Salem.otrs.middleware({ isState: 'NUEVO' }, nuevoTicket)
                        if (middleware) {
                            await Salem.utils.loading({ title: 'Realizando traza', message: 'Realizando traza de estados' })
                            let sweep = await Salem.core.runtime.sweepCreate(nuevoTicket, { firma: storage.login.firma, ...data })
                            if (sweep) {
                                await Salem.otrs.utils.move(nuevoTicket, 'RUTINARIOS ESTACIONES')

                                let otoboUrl = `https://helpdesk.rbsas.co/otobo/index.pl?Action=AgentTicketNote;TicketID=${nuevoTicket.id}`;
                                window.open(otoboUrl, "otoboWindow", "popup,width=1200,height=1200");

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
                        contador++
                    }
                    await Salem.utils.loading()
                    $('[data-tag="sidebar-content"]').html(note)
                    for (let ticket of generados) {
                        Salem.core.runtime.zoomTicket(ticket)
                    }

                    if (generados.length == otrsCheckDuplicity.length) window.close()
                })
            })

            $('[name="plan"]').on('change', changePrevType)
        })

        function changePrevType() {
            let tipo = $(this).val()
            $('input[name="asunto"]').val(storage.config.planes.active[tipo])
            $('[data-tag="planContainer"]').removeClass('d-none')
            $('[data-tag="plan"]').text(storage.config.planes.active[tipo])
        }

        function checkDuplicity(package) {
            return new Promise(async resolve => {
                let res = []
                for (let u of package) {
                    await Salem.utils.loading({
                        title: 'Verificando duplicidad',
                        message: `Se está verificando duplicidad para el equipo ${u.cmdb.equipo} ${u.cmdb.name} de ${u.cmdb.estacion}`
                    })
                    let search = null
                    search = storage.config.utils.checkDuplicity
                    search.Search_DynamicField_IDEQUIPO = u.cmdb.name
                    search.Title = `"${u.cmdb.asunto}"`
                    search.ServiceIDs = [u.create.service_id]
                    let hasDuplicity = await Salem.otrs.ajax(search)
                    res.push({ ...u, hasDuplicity })
                }
                resolve(res)
            })
        }
    }
}

// Para inicializar el módulo cuando cambies a él:
window.mttoEspecialesModule.init()