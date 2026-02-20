$(() => {
    let eventsData = [];

    const meses = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
    const quincenas = ['Q1', 'Q2'];

    function generarOpcionesNombres() {
        let opciones = [];

        ['BCA', 'TCA'].forEach(tipo => {
            meses.forEach(mes => {
                quincenas.forEach(q => {
                    opciones.push(`${tipo} ${mes} ${q}`);
                });
            });
        });

        meses.forEach(mes => {
            opciones.push(`RACK ${mes}`);
        });

        return opciones;
    }

    const opcionesNombres = generarOpcionesNombres();

    loadEvents();

    async function loadEvents() {
        await Salem.utils.loading({
            title: "Consultando eventos",
            message: "Se están obteniendo los eventos rutinarios del calendario.",
        });

        try {
            let response = await Salem.core.api({
                action: 'updateRutinarios',
                subaction: 'get'
            });

            await Salem.utils.loading();

            if (response && response.done && response.data) {
                eventsData = response.data;
                renderTable();
            } else {
                throw new Error(response.message || 'Error al cargar los datos');
            }
        } catch (error) {
            await Salem.utils.loading();
            console.error('Error loading events:', error);
            Salem.utils.toast({
                title: 'Error al cargar eventos',
                message: error.message || 'Ocurrió un error desconocido',
                type: 'error',
                noHide: true
            });
        }
    }

    function renderTable() {
        const tbody = $('#eventsTableBody');
        tbody.empty();

        if (eventsData.length === 0) {
            tbody.append(`
            <tr>
                <td colspan="6" class="text-center text-muted py-4">
                    <i class="fas fa-inbox fa-2x mb-2"></i><br>
                    No hay eventos rutinarios configurados
                </td>
            </tr>
        `);
            $('#btnCargarPlan').prop('disabled', true);
            return;
        }

        eventsData.forEach((event, index) => {
            let opcionesFiltradas = [];
            let filtro = (event.filtro || '').toUpperCase().trim();

            let tipo = '';
            if (filtro.includes('BCA')) {
                tipo = 'BCA';
            } else if (filtro.includes('TCA')) {
                tipo = 'TCA';
            } else if (filtro.includes('RACK') || filtro.includes('SISTEMA DE RESPALDO')) {
                tipo = 'RACK';
            }

            let quincenaActual = event.quincena || '';

            if (!quincenaActual && event.nombre) {
                let matchQ = event.nombre.match(/Q([12])/);
                if (matchQ) {
                    quincenaActual = 'Q' + matchQ[1];
                    event.quincena = quincenaActual;
                }
            }

            if (!quincenaActual) {
                quincenaActual = (index % 2 === 0) ? 'Q1' : 'Q2';
                event.quincena = quincenaActual;
            }

            console.log(`Renderizando evento ${index}: ${event.nombre} - Quincena: ${quincenaActual}`);

            if (tipo === 'BCA' || tipo === 'TCA') {
                // Filtrar primero por tipo (BCA o TCA)
                opcionesFiltradas = opcionesNombres.filter(opt => opt.startsWith(tipo));
                // Luego filtrar por quincena (Q1 o Q2)
                opcionesFiltradas = opcionesFiltradas.filter(opt => opt.includes(quincenaActual));
            } else if (tipo === 'RACK') {
                // RACK no tiene quincenas, solo filtrar por tipo
                opcionesFiltradas = opcionesNombres.filter(opt => opt.startsWith('RACK'));
            } else {
                opcionesFiltradas = opcionesNombres;
            }

            let optionsHTML = '<option value="">Seleccione un nombre</option>';
            opcionesFiltradas.forEach(opcion => {
                const selected = event.nombre === opcion ? 'selected' : '';
                optionsHTML += `<option value="${opcion}" ${selected}>${opcion}</option>`;
            });

            const row = $(`
            <tr data-index="${index}">
                <td>
                    <input 
                        type="datetime-local" 
                        class="form-control form-control-sm fecha-input" 
                        data-index="${index}"
                        value="${formatDateForInput(event.fecha)}"
                    />
                </td>
                <td class="align-middle">
                    <span class="badge bg-dark">${event.action || 'Rutinarios'}</span>
                </td>
                <td class="align-middle">
                    <span class="badge bg-success">${event.subaction || 'Cargar'}</span>
                </td>
                <td>
                    <select 
                        class="form-select form-select-sm nombre-select" 
                        data-index="${index}">
                        ${optionsHTML}
                    </select>
                </td>
                <td class="align-middle">${event.filtro || ''}</td>
                <td class="align-middle">
                    <span class="badge bg-primary quincena-badge" data-index="${index}">${quincenaActual}</span> ${event.llave || ''}
                </td>
            </tr>
        `);
            tbody.append(row);
        });

        $('.fecha-input').on('change', handleInputChange);
        $('.nombre-select').on('change', handleInputChange);
    }

    function formatDateForInput(dateString) {
        return dateString ? moment(dateString, 'YYYY-MM-DD HH:mm:ss').format('YYYY-MM-DDTHH:mm') : '';
    }

    function formatDateFromInput(inputValue) {
        return inputValue ? moment(inputValue).format('YYYY-MM-DD HH:mm:ss') : '';
    }

    function handleInputChange(e) {
        const index = $(e.target).data('index');

        if ($(e.target).hasClass('fecha-input')) {
            const newValue = $(e.target).val();
            eventsData[index].fecha = formatDateFromInput(newValue);
        }
        else if ($(e.target).hasClass('nombre-select')) {
            const newValue = $(e.target).val();

            if (!eventsData[index].quincenaOriginal) {
                eventsData[index].quincenaOriginal = eventsData[index].quincena;
            }

            eventsData[index].nombre = newValue;

            if (newValue) {
                let matchQ = newValue.match(/Q([12])/);
                if (matchQ) {
                    eventsData[index].quincena = 'Q' + matchQ[1];
                    $(`.quincena-badge[data-index="${index}"]`).text(eventsData[index].quincena);
                }
            }

            console.log(`Evento ${index}:`, eventsData[index]);
        }
    }

    $('#btnCargarPlan').on('click', async function () {
        // Validar que todos los eventos tengan nombre y fecha
        let eventosInvalidos = eventsData.filter(e => !e.nombre || !e.fecha);
        if (eventosInvalidos.length > 0) {
            await Salem.utils.swal.fire({
                icon: 'warning',
                title: 'Datos incompletos',
                text: `Hay ${eventosInvalidos.length} evento(s) sin nombre o fecha. Por favor completa todos los campos.`,
                confirmButtonText: 'Entendido'
            });
            return;
        }

        // Asegurarse de que cada evento tenga su quincena antes de enviar
        eventsData.forEach((event, idx) => {
            if (!event.quincena && event.nombre) {
                let matchQ = event.nombre.match(/Q([12])/);
                if (matchQ) {
                    event.quincena = 'Q' + matchQ[1];
                }
            }
            console.log(`Evento ${idx} antes de enviar:`, {
                nombre: event.nombre,
                quincena: event.quincena,
                fecha: event.fecha,
                filtro: event.filtro,
                llave: event.llave
            });
        });

        await Salem.utils.loading({
            title: "Actualizando eventos",
            message: "Se están guardando los cambios en el calendario.",
        });

        try {
            console.log('Datos a enviar para UPDATE:', JSON.stringify(eventsData, null, 2));

            // PASO 1: Actualizar los eventos en la hoja
            let updateResponse = await Salem.core.api({
                action: 'updateRutinarios',
                subaction: 'update',
                data: eventsData
            });

            console.log('Respuesta del UPDATE:', updateResponse);

            if (!updateResponse || !updateResponse.done) {
                throw new Error(updateResponse.message || 'Error al actualizar los eventos');
            }

            await Salem.utils.loading({
                title: "Programando eventos",
                message: "Se están programando los planes en el calendario de Google.",
            });

            // PASO 2: Programar cada evento en el calendario
            let programacionExitosa = 0;
            let programacionFallida = [];

            for (let event of eventsData) {
                try {
                    console.log(`Programando evento: ${event.nombre} (${event.quincena})`);

                    let programarResponse = await Salem.core.api({
                        action: 'updateRutinarios',
                        subaction: 'programar',
                        data: event
                    });

                    console.log(`Respuesta de PROGRAMAR para ${event.nombre}:`, programarResponse);

                    if (programarResponse && programarResponse.done) {
                        programacionExitosa++;
                    } else {
                        programacionFallida.push({
                            nombre: event.nombre,
                            error: programarResponse.message
                        });
                    }
                } catch (error) {
                    console.error(`Error programando ${event.nombre}:`, error);
                    programacionFallida.push({
                        nombre: event.nombre,
                        error: error.message
                    });
                }
            }

            await Salem.utils.loading();

            // Mostrar resultado final
            if (programacionFallida.length === 0) {
                await Salem.utils.swal.fire({
                    icon: 'success',
                    title: '¡Éxito!',
                    html: `
                        <p><strong>${updateResponse.updatedCount}</strong> eventos actualizados correctamente.</p>
                        <p><strong>${programacionExitosa}</strong> planes programados en el calendario.</p>
                        <p>Los planes se crearán automáticamente en las fechas programadas.</p>
                    `,
                    confirmButtonText: 'Entendido'
                });
            } else {
                let htmlErrores = programacionFallida.map(e =>
                    `<li><strong>${e.nombre}</strong>: ${e.error}</li>`
                ).join('');

                await Salem.utils.swal.fire({
                    icon: 'warning',
                    title: 'Programación parcial',
                    html: `
                        <p><strong>${programacionExitosa}</strong> eventos programados exitosamente.</p>
                        <p><strong>${programacionFallida.length}</strong> eventos con error:</p>
                        <ul style="text-align: left; max-height: 200px; overflow-y: auto;">
                            ${htmlErrores}
                        </ul>
                    `,
                    confirmButtonText: 'Entendido'
                });
            }

            // Recargar la tabla
            await loadEvents();

        } catch (error) {
            await Salem.utils.loading();
            console.error('Error:', error);
            Salem.utils.toast({
                title: 'Error',
                message: error.message || 'Ocurrió un error desconocido',
                type: 'error',
                noHide: true
            });
        }
    });
});