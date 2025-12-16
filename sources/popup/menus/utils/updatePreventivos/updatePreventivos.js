$(() => {
    // Estado de la aplicación
    const state = {
        allData: {},
        currentData: [],
        currentEquipo: '',
        currentColumns: []
    };

    // Configuraciones
    const CONFIG = {
        equipoNames: {
            cctv: '1. CCTV',
            ups: '2. UPS EST-2',
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
        }
    };

    // Inicialización
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
    }

    // Carga de datos
    async function loadPreventivos() {
        await showLoading('Consultando mtto Preventivos', 'Se están obteniendo los mantenimientos preventivos.');

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
            showToast('Error al cargar datos', error.message || 'Ocurrió un error desconocido', 'error');
            showEmptyState('Error al cargar los datos. Por favor, intente nuevamente.');
        }
    }

    // Manejo de eventos
    function handleEquipoChange() {
        const equipoKey = $(this).val();

        if (!equipoKey) {
            resetState();
            clearKPIs();
            showEmptyState('Seleccione un tipo de equipo para ver los datos.');
            return;
        }

        state.currentEquipo = equipoKey;
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

        if (rawData.length > 0) {
            state.currentColumns = rawData[0];
            state.currentData = processEquipoData(rawData.slice(1), state.currentColumns, equipoKey);
        } else {
            state.currentColumns = [];
            state.currentData = [];
        }

        updateTableHeaders(state.currentColumns);
        renderTable(state.currentData);
        updateRecordCount(state.currentData.length);
        $('#resultsInfo').addClass('d-none');

        // Calcular y mostrar KPIs automáticamente
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

                // Si la columna contiene "FECHA", también buscar en el formato formateado
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

        data.forEach(row => {
            const tdElements = state.currentColumns.map(col =>
                createTableCell(col, row[col])
            ).join('');

            tbody.append(`<tr>${tdElements}</tr>`);
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

        // Destruir gráficos existentes
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
        await showLoading('Calculando KPIs', 'Procesando indicadores de gestión...');

        try {
            // Verificar que haya datos cargados
            if (!state.allData || Object.keys(state.allData).length === 0) {
                await hideLoading();
                showToast('Sin datos', 'Primero debe cargar los datos de preventivos', 'warning');
                return;
            }

            // Calcular KPIs desde los datos ya cargados
            const kpisData = calculateKPIsFromData();
            console.log('1. KPIs calculados:', kpisData);

            await hideLoading();

            if (kpisData && Object.keys(kpisData).length > 0) {
                // Simular estructura del API
                const response = {
                    done: true,
                    data: kpisData
                };
                console.log('2. Response creado:', response);

                const loaded = loadKPIData(response);
                console.log('3. Loaded result:', loaded);
                console.log('4. state.kpisData:', state.kpisData);

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
            showToast('Error al calcular KPIs', error.message || 'Ocurrió un error desconocido', 'error');
        }
    }

    function calculateKPIsFromData() {
        const kpis = {};

        // Solo calcular KPIs para el equipo actualmente seleccionado
        if (!state.currentEquipo) {
            console.warn('No hay equipo seleccionado');
            return kpis;
        }

        const equipoKey = state.currentEquipo;
        const equipoData = state.allData[equipoKey];

        if (!equipoData) {
            console.warn(`No hay datos para el equipo ${equipoKey}`);
            return kpis;
        }

        const rawData = equipoData.data || [];

        if (rawData.length === 0) {
            console.warn(`Datos vacíos para ${equipoKey}`);
            return kpis;
        }

        const headers = rawData[0];
        const rows = rawData.slice(1);

        const estadoIndex = headers.findIndex(h =>
            h && h.toString().toUpperCase().includes('ESTADO')
        );

        if (estadoIndex === -1) {
            console.warn(`No se encontró columna ESTADO para ${equipoKey}`);
            return kpis;
        }

        let total = rows.length;
        let pendientes = 0;

        rows.forEach(row => {
            const estado = row[estadoIndex];
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

        console.log('KPIs calculados para', equipoKey, ':', kpis);
        return kpis;
    }

    function loadKPIData(apiResponse) {
        if (!apiResponse || !apiResponse.data) {
            console.error('Respuesta del API inválida');
            return false;
        }

        if (typeof apiResponse.data !== 'object' || Array.isArray(apiResponse.data)) {
            console.error('Los datos del API deben ser un objeto con claves de equipos');
            return false;
        }

        const cleanedData = {};

        for (const [equipoKey, equipoData] of Object.entries(apiResponse.data)) {
            if (Array.isArray(equipoData) && equipoData.length >= 4) {
                cleanedData[equipoKey] = equipoData.slice(1, 4);
            }
        }

        if (Object.keys(cleanedData).length === 0) {
            console.error('No se encontraron datos válidos de equipos');
            return false;
        }

        state.kpisData = cleanedData;
        console.log('KPIs cargados exitosamente:', cleanedData);
        return true;
    }

    function renderKPICharts() {
        const container = $('#kpisContainer');
        container.empty();

        // Destruir gráficos anteriores con validación
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
            console.warn(`No se pudieron procesar los datos para ${equipoKey}`);
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
        console.log('parseEquipoKPIData recibió:', data);

        if (!Array.isArray(data) || data.length < 3) {
            console.warn('parseEquipoKPIData: datos inválidos', data);
            return null;
        }

        const total = parseInt(data[0][1]) || 0;
        const pendientes = parseInt(data[1][1]) || 0;
        const realizados = parseInt(data[2][1]) || 0;

        console.log('parseEquipoKPIData resultado:', { total, pendientes, realizados });
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

    // ========== DOWNLOAD PENDIENTES ==========

    async function downloadPendientes() {
        await showLoading('Descargando', 'Obteniendo tickets pendientes de mantenimiento preventivo...');

        try {
            // Obtener el plan activo de preventivos desde storage
            const plan = storage.config.planes.active.contractual;

            if (!plan) {
                throw new Error('No se encontró el plan de preventivos configurado');
            }

            // Llamar al API para obtener los pendientes
            const jsonRes = await Salem.core.api({
                action: 'pendientes',
                subaction: 'preventivos',
                plan: plan,
                config: storage.config.planes
            });

            await hideLoading();

            if (jsonRes && typeof jsonRes === 'object') {
                // Crear un nuevo libro de Excel
                const wb = XLSX.utils.book_new();
                let totalPendientes = 0;

                // Recorrer cada equipo y crear una hoja por cada uno
                for (const [equipoNombre, equipoData] of Object.entries(jsonRes)) {
                    if (Array.isArray(equipoData) && equipoData.length > 0) {
                        // Limpiar datos innecesarios
                        const cleanData = equipoData.map(item => {
                            const cleaned = { ...item };
                            delete cleaned.key;
                            delete cleaned.deployment;
                            delete cleaned.status;
                            delete cleaned.index;
                            return cleaned;
                        });

                        // Crear hoja para este equipo
                        const ws = XLSX.utils.json_to_sheet(cleanData);

                        // Nombre de la hoja (máximo 31 caracteres para Excel)
                        const sheetName = equipoNombre.substring(0, 31);

                        // Agregar hoja al libro
                        XLSX.utils.book_append_sheet(wb, ws, sheetName);

                        totalPendientes += cleanData.length;
                    }
                }

                // Verificar si hay datos para descargar
                if (wb.SheetNames.length > 0) {
                    // Generar y descargar el archivo
                    XLSX.writeFile(wb, `Pendientes Mtto Preventivo ${plan} ${moment().format('DD-MM-YYYY HH_mm')}.xlsx`);

                    showToast('Descarga Exitosa', `Se descargaron ${totalPendientes} tickets pendientes en ${wb.SheetNames.length} hojas`, 'success');
                } else {
                    showToast('Sin Pendientes', 'No hay tickets pendientes de mantenimiento preventivo', 'info');
                }
            } else {
                showToast('Sin Pendientes', 'No hay tickets pendientes de mantenimiento preventivo', 'info');
            }
        } catch (error) {
            await hideLoading();
            console.error('Error downloading pendientes:', error);
            showToast('Error al Descargar', error.message || 'Ocurrió un error al descargar los pendientes', 'error');
        }
    }
});

