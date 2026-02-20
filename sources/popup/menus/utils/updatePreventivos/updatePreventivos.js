$(() => {
    // Estado de la aplicaci�n
    const state = {
        allData: {},
        currentData: [],
        currentEquipo: '',
        currentColumns: [],
        selectedRows: []
    };

    // Configuraciones
    const CONFIG = {
        equipoNames: {
            cctv: '1. CCTV',
            ups: '2. UPS EST-1',
            bca: '3. BCA',
            tca: '4. TCA',
            tcs: '5. TCS',
            eqMoviles: '6. EQ MOV',
            pip: '7. PIP',
            pp: '8. PP',
            upsCC: '9. UPS-GE CC'
        },
        estadoBadges: {
            completado: 'bg-success',
            cerrado: 'bg-success',
            pendiente: 'bg-warning text-dark',
            'en proceso': 'bg-info',
            default: 'bg-secondary'
        },
        chartColors: {
            realizados: '#28a745',
            pendientes: '#ffc107',
            total: '#6c757d'
        },
        report: {
            subjectPrefix: 'Novedad: '
        }
    };

    // Inicializaci�n
    init();

    function init() {
        loadPreventivos();
        setupEventListeners();
    }

    function setupEventListeners() {
        $('#equipoSelect').on('change', handleEquipoChange);
        $('#searchInput').on('input', handleSearch);
        $('#clearSearch').on('click', clearSearch);
        $('#toggleKPIs').on('click', loadKPIs);
        $('#downloadPendientes').on('click', downloadPendientes);
        $('#btnOpenReport').on('click', openReportModal);

        // Selección de filas en la tabla
        $('#preventivosTableBody').on('click', 'tr', function () {
            const rowId = $(this).data('row-id');
            const rowData = state.currentData.find(r => (r.TICKET || r.ticket || r.ID || r.id || '').toString() === rowId.toString());

            if (!rowData) return;

            $(this).toggleClass('table-primary selected-row');

            if ($(this).hasClass('selected-row')) {
                const idProp = rowData.TICKET ? 'TICKET' : (rowData.ticket ? 'ticket' : (rowData.ID ? 'ID' : 'id'));
                if (!state.selectedRows.some(r => r[idProp] === rowData[idProp])) {
                    state.selectedRows.push(rowData);
                }
            } else {
                const idProp = rowData.TICKET ? 'TICKET' : (rowData.ticket ? 'ticket' : (rowData.ID ? 'ID' : 'id'));
                state.selectedRows = state.selectedRows.filter(r => r[idProp] !== rowData[idProp]);
            }
        });

        // Prevenir el envío del formulario al presionar Enteros
        $('#updatePreventivos').on('submit', function (e) {
            e.preventDefault();
        });
    }

    // Carga de datos
    async function loadPreventivos() {
        await showLoading('Consultando mtto Preventivos', 'Se estn obteniendo los mantenimientos preventivos.');

        try {
            const response = await Salem.core.api({
                action: 'dataPreventivos',
                subaction: 'dashPreventivos'
            });

            await hideLoading();

            if (response?.done) {
                state.allData = response.data || {};
                const message = Object.keys(state.allData).length === 0
                    ? 'No se encontraron datos de mantenimientos preventivos.'
                    : 'Seleccione un tipo de equipo para ver los datos.';
                showEmptyState(message);
            } else {
                throw new Error(response.message || 'Error al cargar los datos');
            }
        } catch (error) {
            await hideLoading();
            console.error('Error loading preventivos:', error);
            showToast('Error al cargar datos', error.message || 'Ocurri� un error desconocido', 'error');
            showEmptyState('Error al cargar los datos. Por favor, intente nuevamente.');
        }
    }

    // Manejo de eventos
    function handleEquipoChange() {
        const equipoKey = $(this).val();

        if (!equipoKey) {
            resetState();
            clearKPIs();
            state.selectedRows = [];
            showEmptyState('Seleccione un tipo de equipo para ver los datos.');
            return;
        }

        state.currentEquipo = equipoKey;
        state.selectedRows = [];
        const equipoData = state.allData[equipoKey];

        if (!equipoData) {
            resetState();
            clearKPIs();
            showEmptyState(`No hay datos disponibles para ${CONFIG.equipoNames[equipoKey]}`);
            return;
        }

        loadEquipoData(equipoData, equipoKey);
    }

    function loadEquipoData(equipoData, equipoKey) {
        const rawData = equipoData.data || [];
        state.currentData = [];
        state.currentColumns = [];

        if (rawData.length > 0) {
            // Backend Salem.utils.query returns Array of Objects
            if (typeof rawData[0] === 'object' && !Array.isArray(rawData[0])) {
                // Extract columns from the first object keys
                // We use the 'columns' from config if available to ensure order, or fall back to keys
                // backend returns columns in 'columns' property sometimes? No, it returns {data: [], columns: []} in dashPreventivos

                if (equipoData.columns && equipoData.columns.length > 0) {
                    state.currentColumns = equipoData.columns;
                } else {
                    // Si no, intentar inferir, pero ignorando keys que parecen basura de totales
                    const validKeys = [
                        'ticket', 'linea', 'estacion', 'ubicacion', 'id', 'equipo',
                        'fecha', 'estado', 'tecnico', 'asunto', 'direccion', 'modelo', 'empresa'
                    ];

                    state.currentColumns = Object.keys(rawData[0]).filter(key =>
                        validKeys.includes(key.toLowerCase())
                    );
                }

                // Add tipoEquipo to each row
                state.currentData = rawData.map(row => ({
                    ...row,
                    tipoEquipo: CONFIG.equipoNames[equipoKey] || equipoKey
                }));
            }
            // Legacy/Matrix support (Array of Arrays)
            else if (Array.isArray(rawData[0])) {
                state.currentColumns = rawData[0];
                state.currentData = processEquipoData(rawData.slice(1), state.currentColumns, equipoKey);
            }
        }

        updateTableHeaders(state.currentColumns);
        renderTable(state.currentData);
        updateRecordCount(state.currentData.length);
        $('#resultsInfo').addClass('d-none');

        // Calcular y mostrar KPIs autom�ticamente
        loadKPIs();
    }

    function handleSearch() {
        const searchTerm = $(this).val().toLowerCase().trim();

        if (!state.currentEquipo) return;

        if (!searchTerm) {
            renderTable(state.currentData);
            updateRecordCount(state.currentData.length);
            $('#resultsInfo').addClass('d-none');
            return;
        }

        const filteredData = filterData(searchTerm);
        renderTable(filteredData);
        updateRecordCount(filteredData.length, state.currentData.length);
        updateSearchResults(filteredData.length, searchTerm);
    }

    function clearSearch() {
        $('#searchInput').val('').trigger('input');
    }

    // Procesamiento de datos
    function processEquipoData(data, columns, equipoKey) {
        if (!Array.isArray(data)) return [];

        return data.map(row => {
            const obj = { tipoEquipo: CONFIG.equipoNames[equipoKey] || equipoKey };
            columns.forEach((col, index) => {
                obj[col] = row[index] || '';
            });
            return obj;
        });
    }

    function filterData(searchTerm) {
        return state.currentData.filter(row =>
            state.currentColumns.some(col => {
                const value = (row[col] || '').toString().toLowerCase();

                // Si la columna contiene "FECHA", tambi�n buscar en el formato formateado
                if (col.toUpperCase().includes('FECHA')) {
                    const formattedDate = formatDate(row[col]).toLowerCase();
                    return value.includes(searchTerm) || formattedDate.includes(searchTerm);
                }

                return value.includes(searchTerm);
            })
        );
    }

    // Renderizado
    function updateTableHeaders(columns) {
        const thead = $('#tableHeaders');
        thead.empty();

        columns.forEach(col => {
            const headerText = capitalizeFirst(col);
            thead.append(`<th>${headerText}</th>`);
        });
    }

    function renderTable(data) {
        const tbody = $('#preventivosTableBody');
        tbody.empty();

        if (data.length === 0) {
            showEmptyState('No se encontraron registros con los filtros aplicados.');
            return;
        }

        data.forEach((row, index) => {
            const tdElements = state.currentColumns.map(col =>
                createTableCell(col, row[col])
            ).join('');

            const rowId = row.TICKET || row.ticket || row.ID || row.id || index;
            const isSelected = state.selectedRows.some(r =>
                (r.TICKET || r.ticket || r.ID || r.id) === (row.TICKET || row.ticket || row.ID || row.id)
            );
            const selectedClass = isSelected ? 'table-primary selected-row' : '';

            tbody.append(`<tr data-row-id="${rowId}" class="${selectedClass}">${tdElements}</tr>`);
        });
    }

    function createTableCell(columnName, value) {
        const colUpper = columnName.toUpperCase();
        const safeValue = escapeHtml(value || '');

        if (colUpper === 'ESTADO') {
            const badgeClass = getEstadoBadgeClass(value);
            return `<td><span class="badge ${badgeClass}">${safeValue}</span></td>`;
        }

        if (colUpper.includes('FECHA')) {
            const formattedDate = formatDate(value);
            return `<td>${escapeHtml(formattedDate)}</td>`;
        }

        return `<td>${safeValue}</td>`;
    }

    function showEmptyState(message) {
        const tbody = $('#preventivosTableBody');
        const colspan = state.currentColumns.length || 10;

        tbody.html(`
            <tr>
                <td colspan="${colspan}" class="text-center text-muted py-4">
                    <i class="fas fa-inbox fa-2x mb-2"></i><br>
                    ${message}
                </td>
            </tr>
        `);
    }

    // Utilidades
    function getEstadoBadgeClass(estado) {
        const estadoLower = (estado || '').toLowerCase();

        for (const [key, badgeClass] of Object.entries(CONFIG.estadoBadges)) {
            if (key !== 'default' && estadoLower.includes(key)) {
                return badgeClass;
            }
        }

        return CONFIG.estadoBadges.default;
    }

    function formatDate(dateValue) {
        if (!dateValue) return '';

        const date = moment(dateValue);
        return date.isValid() ? date.format('DD-MM-YYYY') : dateValue;
    }

    function capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }

    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    function resetState() {
        state.currentEquipo = '';
        state.currentData = [];
        state.currentColumns = [];
        updateRecordCount(0);
    }

    function clearKPIs() {
        // Limpiar el contenedor de KPIs
        const container = $('#kpisContainer');
        container.empty();

        // Destruir gr�ficos existentes
        if (state.chartInstances && typeof state.chartInstances === 'object') {
            Object.values(state.chartInstances).forEach(chart => {
                if (chart) chart.destroy();
            });
        }
        state.chartInstances = {};
        state.kpisData = null;
    }

    function updateRecordCount(current, total = null) {
        const text = total !== null
            ? `Mostrando ${current} de ${total} registros`
            : `Total de registros: ${current}`;
        $('#recordCount').text(text);
    }

    function updateSearchResults(resultCount, searchTerm) {
        const resultsInfo = $('#resultsInfo');
        const resultsText = $('#resultsText');

        if (resultCount === 0) {
            resultsInfo.removeClass('d-none');
            resultsText.text(`No se encontraron resultados para "${searchTerm}"`);
        } else {
            resultsInfo.removeClass('d-none');
            resultsText.text(`Se encontraron ${resultCount} resultado(s) de ${state.currentData.length} total(es)`);
        }
    }

    async function showLoading(title, message) {
        await Salem.utils.loading({ title, message });
    }

    async function hideLoading() {
        await Salem.utils.loading();
    }

    function showToast(title, message, type) {
        Salem.utils.toast({ title, message, type, noHide: true });
    }

    // ========== KPIs FUNCTIONS ==========

    async function loadKPIs() {
        await showLoading('Calculando KPIs', 'Procesando indicadores de gesti�n...');

        try {
            // Verificar que haya datos cargados
            if (!state.allData || Object.keys(state.allData).length === 0) {
                await hideLoading();
                showToast('Sin datos', 'Primero debe cargar los datos de preventivos', 'warning');
                return;
            }

            // Calcular KPIs desde los datos ya cargados
            const kpisData = calculateKPIsFromData();

            await hideLoading();

            if (kpisData && Object.keys(kpisData).length > 0) {
                // Simular estructura del API
                const response = {
                    done: true,
                    data: kpisData
                };

                const loaded = loadKPIData(response);

                if (loaded) {
                    renderKPICharts();
                } else {
                    throw new Error('No se pudieron procesar los datos de KPIs');
                }
            } else {
                throw new Error('No se pudieron calcular los KPIs');
            }
        } catch (error) {
            await hideLoading();
            console.error('Error calculating KPIs:', error);
            showToast('Error al calcular KPIs', error.message || 'Ocurri� un error desconocido', 'error');
        }
    }

    function calculateKPIsFromData() {
        const kpis = {};

        // Solo calcular KPIs para el equipo actualmente seleccionado
        if (!state.currentEquipo) {
            return kpis;
        }

        const equipoKey = state.currentEquipo;
        // Usar state.currentData que ya est normalizado (Array de Objetos)
        const data = state.currentData || [];

        if (data.length === 0) {
            return kpis;
        }

        // Buscar el nombre de la columna 'estado'
        const estadoCol = state.currentColumns.find(col =>
            col && col.toString().toUpperCase().includes('ESTADO')
        );

        if (!estadoCol) {
            return kpis;
        }

        let total = data.length;
        let pendientes = 0;

        data.forEach(row => {
            const estado = row[estadoCol];
            if (!estado || estado.toString().trim() === '') {
                pendientes++;
            }
        });

        let realizados = total - pendientes;

        const equipoName = CONFIG.equipoNames[equipoKey] || equipoKey;

        kpis[equipoKey] = [
            [equipoName, 'Data'],
            ['TOTAL EQUIPOS', total],
            ['EQUIPOS PENDIENTES', pendientes],
            ['EQUIPOS REALIZADOS', realizados]
        ];

        return kpis;
    }

    function loadKPIData(apiResponse) {
        if (!apiResponse || !apiResponse.data) {
            return false;
        }

        if (typeof apiResponse.data !== 'object' || Array.isArray(apiResponse.data)) {
            return false;
        }

        const cleanedData = {};

        for (const [equipoKey, equipoData] of Object.entries(apiResponse.data)) {
            if (Array.isArray(equipoData) && equipoData.length >= 4) {
                cleanedData[equipoKey] = equipoData.slice(1, 4);
            }
        }

        if (Object.keys(cleanedData).length === 0) {
            return false;
        }

        state.kpisData = cleanedData;
        return true;
    }

    function renderKPICharts() {
        const container = $('#kpisContainer');
        container.empty();

        // Destruir grficos anteriores con validacin
        if (state.chartInstances && typeof state.chartInstances === 'object') {
            Object.values(state.chartInstances).forEach(chart => {
                if (chart) chart.destroy();
            });
        }
        state.chartInstances = {};

        if (!state.kpisData || Object.keys(state.kpisData).length === 0) {
            container.html(`
                <div class="col-12 text-center text-muted py-4">
                    <i class="fas fa-chart-pie fa-2x mb-2"></i><br>
                    No hay datos de KPIs disponibles
                </div>
            `);
            return;
        }

        for (const [equipoKey, equipoData] of Object.entries(state.kpisData)) {
            const equipoName = CONFIG.equipoNames[equipoKey] || equipoKey;
            const chartId = `chart-${equipoKey}`;

            const chartCard = $(`
                <div class="col-12">
                    <div class="card shadow-sm mx-auto" style="max-width: 500px;">
                        <div class="card-header bg-primary text-white text-center">
                            <h6 class="mb-0">
                                <i class="fas fa-cog me-1"></i>
                                ${equipoName}
                            </h6>
                        </div>
                        <div class="card-body d-flex justify-content-center">
                            <div style="max-width: 350px; width: 100%;">
                                <canvas id="${chartId}"></canvas>
                            </div>
                        </div>
                        <div class="card-footer bg-light">
                            <div class="row text-center small" id="stats-${equipoKey}">
                            </div>
                        </div>
                    </div>
                </div>
            `);

            container.append(chartCard);
            createPieChart(chartId, equipoKey, equipoData);
        }
    }

    function createPieChart(canvasId, equipoKey, data) {
        const kpiData = parseEquipoKPIData(data);

        if (!kpiData) {
            return;
        }

        const { total, pendientes, realizados } = kpiData;
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        const chart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Realizados', 'Pendientes'],
                datasets: [{
                    data: [realizados, pendientes],
                    backgroundColor: [
                        CONFIG.chartColors.realizados,
                        CONFIG.chartColors.pendientes
                    ],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 15,
                            font: { size: 12 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });

        state.chartInstances[equipoKey] = chart;
        updateChartStats(equipoKey, kpiData);
    }

    function parseEquipoKPIData(data) {

        if (!Array.isArray(data) || data.length < 3) {
            return null;
        }

        const total = parseInt(data[0][1]) || 0;
        const pendientes = parseInt(data[1][1]) || 0;
        const realizados = parseInt(data[2][1]) || 0;

        return { total, pendientes, realizados };
    }

    function updateChartStats(equipoKey, kpiData) {
        const { total, pendientes, realizados } = kpiData;
        const percentage = total > 0 ? ((realizados / total) * 100).toFixed(1) : 0;

        const statsHtml = `
            <div class="col-4">
                <div class="text-muted">Total</div>
                <div class="fw-bold">${total}</div>
            </div>
            <div class="col-4">
                <div class="text-muted">Pendientes</div>
                <div class="fw-bold text-warning">${pendientes}</div>
            </div>
            <div class="col-4">
                <div class="text-muted">Realizados</div>
                <div class="fw-bold text-success">${realizados}</div>
            </div>
            <div class="col-12 mt-2">
                <div class="progress" style="height: 20px;">
                    <div class="progress-bar bg-success" role="progressbar" 
                         style="width: ${percentage}%" 
                         aria-valuenow="${percentage}" 
                         aria-valuemin="0" 
                         aria-valuemax="100">
                        ${percentage}%
                    </div>
                </div>
            </div>
        `;

        $(`#stats-${equipoKey}`).html(statsHtml);
    }

    // ========== DOWNLOAD PENDIENTES (ExcelJS) ==========

    /**
     * Genera y descarga un archivo Excel con los datos de mantenimientos preventivos pendientes.
     * Utiliza la utilidad centralizada Salem.utils.excelExport.
     */
    async function downloadPendientes() {
        if (!state.allData || Object.keys(state.allData).length === 0) {
            Salem.utils.toast({ title: 'Sin Datos', message: 'No hay datos cargados para descargar.', type: 'warning' });
            return;
        }

        await Salem.utils.loading({ title: 'Descargando', message: 'Generando archivo Excel...' });

        try {
            const plan = moment().format('Q'); // Trimestre actual
            const dataToExport = {};
            let totalPendientes = 0;

            for (const [equipoKey, equipoObj] of Object.entries(state.allData)) {
                const equipoNombre = CONFIG.equipoNames[equipoKey] || equipoKey;
                const rawData = equipoObj.data || [];
                if (rawData.length === 0) continue;

                let sheetData = [];
                let columns = [];

                // 1. Normalizar datos a Array de Objetos (Misma lógica que Rutinarios)
                if (typeof rawData[0] === 'object' && !Array.isArray(rawData[0])) {
                    columns = Object.keys(rawData[0]);
                    sheetData = rawData;
                } else if (Array.isArray(rawData[0])) {
                    columns = rawData[0];
                    sheetData = processEquipoData(rawData.slice(1), columns, equipoKey);
                }

                const isPP = equipoNombre === '8. PP';
                let processedRows = [];

                if (isPP) {
                    // Procesamiento especial para equipo "PP" (Puntos Presenciales)
                    processedRows = sheetData.map(item => ({
                        'TICKET': item.ticket || item.Ticket || '',
                        'MODELO': item.modelo || item.Modelo || '',
                        'DIRECCIÓN': item.direccion || item['Dirección'] || item.Direccion || '',
                        'ESTADO': item.estado || item.Estado || '',
                        'TÉCNICO': item.tecnico || item['Técnico'] || item.Tecnico || '',
                        'ASUNTO': item.asunto || item.Asunto || ''
                    }));
                } else {
                    // Procesamiento estándar para otros tipos de equipos
                    processedRows = sheetData.map(item => {
                        const cleaned = {};
                        Object.keys(item).forEach(key => {
                            const upperKey = key.toUpperCase().trim();
                            // Excluir claves internas y vacías
                            const isInternal = ['KEY', 'DEPLOYMENT', 'STATUS', 'INDEX', 'TIPOEQUIPO', ''].includes(upperKey);
                            if (!isInternal) {
                                const newKey = cleanColumnName(key).toUpperCase();
                                if (newKey && newKey.trim() !== '') {
                                    cleaned[newKey] = item[key];
                                }
                            }
                        });
                        return cleaned;
                    });
                }

                if (processedRows.length > 0) {
                    const sheetName = equipoNombre.replace(/^\d+\.\s*/, '');
                    dataToExport[sheetName] = processedRows;
                    totalPendientes += processedRows.length;
                }
            }

            const fileName = `Pendientes_Mtto_Preventivo_Q${plan}_${moment().format('YYYY-MM-DD_HHmm')}.xlsx`;
            const success = await Salem.utils.excelExport(dataToExport, fileName, 'Salem - Mtto Preventivos');

            if (success) {
                Salem.utils.toast({
                    title: 'Descarga Completada',
                    message: `Se descargaron ${totalPendientes} pendientes exitosamente.`,
                    type: 'success'
                });
            } else {
                Salem.utils.toast({ title: 'Aviso', message: 'No se encontraron datos habilitados para exportar.', type: 'info' });
            }

        } catch (error) {
            Salem.utils.toast({ title: 'Error al Exportar', message: error.message, type: 'error' });
        } finally {
            await Salem.utils.loading();
        }
    }

    /**
     * Limpia y normaliza el nombre de una columna.
     */
    function cleanColumnName(name) {
        if (!name) return '';
        return name
            .replace(/DynamicField_/g, '')
            .replace(/[_-]/g, ' ')
            .trim();
    }

    // ========== REPORT FUNCTIONALITY ==========

    /**
     * Abre el modal de reporte de novedades.
     * Carga el parcial HTML, lo inserta en el DOM y maneja el ciclo de vida del modal.
     */
    async function openReportModal() {
        // FIX: La ruta correcta es Salem.rules.routes.panels.report.view
        // FIX: Se debe pasar un objeto vacío como segundo argumento para evitar error en Object.keys
        const reportModalHtml = await Salem.utils.partials.get(Salem.rules.routes.panels.report.view, {});
        $('body').append(reportModalHtml);

        const modalEl = document.getElementById('reportModal');
        const modal = new bootstrap.Modal(modalEl);

        modal.show();

        // Inicializar CKEditor
        let reportEditor;
        try {
            reportEditor = await ClassicEditor.create(document.querySelector('#reportMessageEditor'), {
                placeholder: 'Describa la novedad con detalle...',
                toolbar: ['heading', '|', 'bold', 'italic', 'link', 'bulletedList', 'numberedList', 'blockQuote', 'insertTable', 'undo', 'redo']
            });
        } catch (error) {
            console.error('Error al inicializar CKEditor:', error);
            $('#reportMessageEditor').hide();
            $('#reportMessage').removeClass('d-none').addClass('form-control');
        }

        // Manejo de Mensajes Rápidos
        $('.quick-msg').on('click', function () {
            const msg = $(this).data('msg');
            if (reportEditor) {
                const currentData = reportEditor.getData();
                reportEditor.setData(currentData + `<p>${msg}</p>`);
            }
        });

        // Importar selección
        $('#btnImportSelected').on('click', function () {
            if (state.selectedRows.length === 0) {
                Salem.utils.toast({ title: 'Aviso', message: 'No hay filas seleccionadas en la tabla.', type: 'info' });
                return;
            }

            let html = '<h6>Equipos Seleccionados:</h6><ul>';
            state.selectedRows.forEach(row => {
                const id = row.TICKET || row.ticket || row.ID || row.id || 'N/A';
                const equipo = row.EQUIPO || row.equipo || row.MODELO || row.modelo || 'N/A';
                const estacion = row.ESTACION || row.estacion || row.DIRECCIÓN || row['DIRECCIÓN'] || 'N/A';
                html += `<li><strong>${equipo} (${id})</strong> - Estación: ${estacion}</li>`;
            });
            html += '</ul>';

            if (reportEditor) {
                const currentData = reportEditor.getData();
                reportEditor.setData(currentData + html);
            }
        });

        // Handle form submission
        $('#btnSendReport').on('click', async function (e) {
            e.preventDefault();

            // Sincronizar datos si el editor existe
            if (reportEditor) {
                $('#reportMessage').val(reportEditor.getData());
            }

            const form = $('#reportForm');
            if (!form[0].checkValidity()) {
                form[0].reportValidity();
                return;
            }

            await handleSendReport(modal, modalEl);
        });

        // Cleanup on close
        modalEl.addEventListener('hidden.bs.modal', function () {
            if (reportEditor) {
                reportEditor.destroy().catch(err => console.error(err));
            }
            $(this).remove();
        });
    }

    /**
     * Procesa el envío del reporte al API.
     * @param {bootstrap.Modal} modal - Instancia del modal
     * @param {HTMLElement} modalEl - Elemento del DOM del modal
     */
    async function handleSendReport(modal, modalEl) {
        const type = $('#reportType').val();
        const message = $('#reportMessage').val();
        const fileInput = $('#reportEvidence')[0];
        const files = fileInput.files;

        // Usar configuración fija
        const subject = `${CONFIG.report.subjectPrefix}${type}`;

        await Salem.utils.loading({ title: 'Enviando Reporte', message: 'Procesando envío de correo...' });

        try {
            // Obtener datos del usuario logueado para la firma
            const storage = await Salem.core.mem.get();
            const userData = storage.login; // Contiene usuario, area, correo, etc.

            // Determinar saludo según la hora
            const hour = new Date().getHours();
            let greeting = 'Buen día';
            if (hour >= 12 && hour < 18) greeting = 'Buenas tardes';
            else if (hour >= 18 || hour < 5) greeting = 'Buenas noches';

            // Preparar adjuntos (Array)
            let attachments = [];
            if (files.length > 0) {
                for (let i = 0; i < files.length; i++) {
                    const fileData = await readFileAsBase64(files[i]);
                    attachments.push(fileData);
                }
            }

            // Construir payload compatible con API Salem
            const payload = {
                action: 'report',
                subaction: 'send',
                subject: subject,
                body: `
                    <p>${greeting},</p>
                    <p>${message}</p>
                    <br>
                    <p>Quedo atento a sus comentarios, muchas gracias.</p>
                `,
                attachments: attachments
            };

            const response = await Salem.core.api(payload);

            if (response && response.done) {
                Salem.utils.toast({ title: 'Éxito', message: 'Reporte enviado correctamente.', type: 'success' });
                modal.hide();
            } else {
                Salem.utils.toast({ title: 'Error', message: 'No se pudo enviar el reporte.', type: 'error' });
            }

        } catch (error) {
            console.error(error);
            Salem.utils.toast({ title: 'Error', message: 'Ocurrió un error al enviar el reporte.', type: 'error' });
        } finally {
            await Salem.utils.loading();
        }
    }

    /**
     * Utilidad para convertir File a Base64.
     * @param {File} file 
     * @returns {Promise<Object>}
     */
    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve({
                name: file.name,
                mimeType: file.type,
                data: reader.result.split(',')[1] // Obtener base64 limpio
            });
            reader.onerror = error => reject(error);
        });
    }
});
