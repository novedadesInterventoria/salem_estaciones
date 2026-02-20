/**
 * @fileoverview Módulo de Gestión de Mantenimientos Rutinarios
 * @description Maneja la visualización, cálculo de KPIs y exportación a Excel
 *              de los mantenimientos rutinarios de equipos (RACK, BCA, TCA).
 * 
 * Funcionalidades principales:
 * - Carga de datos desde el backend (Google Sheets via API)
 * - Visualización en tabla dinámica con filtros
 * - Cálculo y gráficos de KPIs de ejecución
 * - Exportación de reportes Excel con hoja de AVANCES
 * - Sistema de reporte de novedades por correo
 * 
 * @requires jQuery
 * @requires Chart.js
 * @requires ExcelJS
 * @requires moment.js
 * @requires Bootstrap 5
 * @requires Salem.core (API interna)
 * 
 * @version 1.2.3.2
 * @author Salem Team
 */
$(() => {
    // Estado de la aplicación
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
            rack: '1. RACK',
            bca: '2. BCA',
            tca: '3. TCA'
        },
        estadoBadges: {
            habilitado: 'bg-success',
            progreso: 'bg-danger',
            completado: 'bg-success',
            cerrado: 'bg-dark',
            pendiente: 'bg-warning text-dark',
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

    // Inicialización
    init();

    function init() {
        loadRutinarios();
        setupEventListeners();
    }

    function setupEventListeners() {
        $('#equipoSelect').on('change', handleEquipoChange);
        $('#searchInput').on('input', handleSearch);
        $('#clearSearch').on('click', clearSearch);
        $('#toggleKPIs').on('click', loadKPIs);
        $('#downloadRutinarios').on('click', downloadRutinarios);
        $('#btnOpenReport').on('click', openReportModal);

        // Selección de filas en la tabla
        $('#rutinariosTableBody').on('click', 'tr', function () {
            const rowId = $(this).data('row-id');
            const rowData = state.currentData.find(r => (r.ID || r.id || r.key || '').toString() === rowId.toString());

            if (!rowData) return;

            $(this).toggleClass('table-primary selected-row');

            if ($(this).hasClass('selected-row')) {
                if (!state.selectedRows.some(r => (r.ID || r.id || r.key) === (rowData.ID || rowData.id || rowData.key))) {
                    state.selectedRows.push(rowData);
                }
            } else {
                state.selectedRows = state.selectedRows.filter(r => (r.ID || r.id || r.key) !== (rowData.ID || rowData.id || rowData.key));
            }
        });

        // Prevenir el envío del formulario al presionar Enter
        $('#updateCheckRutinarios').on('submit', function (e) {
            e.preventDefault();
        });
    }

    // ========== CARGA DE DATOS ==========

    /**
     * Carga inicial de todos los datos de mantenimientos rutinarios desde el backend.
     * Almacena la respuesta en `state.allData` para su uso posterior sin recargar.
     */
    async function loadRutinarios() {
        await Salem.utils.loading({ title: 'Consultando mtto Rutinarios', message: 'Se están obteniendo los mantenimientos rutinarios.' });

        try {
            const response = await Salem.core.api({
                action: 'dataRutinarios',
                subaction: 'dashRutinarios'
            });

            await Salem.utils.loading();

            if (response?.done) {
                // Nuevo formato espera response.data.data (array de todos los registros) y response.data.config
                state.allData = response.data || {};

                // Verificar si tenemos datos en la propiedad 'data' (nueva estructura) o keys directas (vieja estructura)
                const hasData = state.allData.data && state.allData.data.length > 0;
                const hasOldData = Object.keys(state.allData).some(k => ['rack', 'bca', 'tca'].includes(k));

                if (hasData || hasOldData) {
                    showEmptyState('Seleccione un tipo de equipo para ver los datos.');
                } else {
                    showEmptyState('No se encontraron datos de mantenimientos rutinarios.');
                }
            } else {
                throw new Error(response.message || 'Error al cargar los datos');
            }
        } catch (error) {
            await Salem.utils.loading();
            console.error('Error loading rutinarios:', error);
            Salem.utils.toast({ title: 'Error al cargar datos', message: error.message || 'Ocurrió un error desconocido', type: 'error', noHide: true });
            showEmptyState('Error al cargar los datos. Por favor, intente nuevamente.');
        }
    }

    // Manejo de eventos
    /**
     * Maneja el cambio de selección en el desplegable de equipos.
     * Actualiza la tabla y los KPIs según el equipo seleccionado.
     */
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

        // Lógica para filtrar datos desde la fuente unificada (DATA)
        // O mantener retrocompatibilidad si la estructura no ha cambiado
        let equipoData = [];
        let columns = [];

        if (state.allData.data && Array.isArray(state.allData.data)) {
            // Nueva Estructura: Filtrar por columna 'equipo'
            // Asumimos que la columna 'equipo' existe en los objetos
            const allRows = state.allData.data;

            // Determinar columnas dinámicamente del primer registro si existen
            if (allRows.length > 0) {
                columns = Object.keys(allRows[0]);
            }

            // Filtrar
            // Buscamos que el valor en la columna 'equipo' contenga la clave seleccionada ('rack', 'bca', 'tca')
            // O coincida con el nombre legible
            equipoData = allRows.filter(row => {
                const eqValue = (row.equipo || row.EQUIPO || '').toString().toLowerCase();
                return eqValue.includes(equipoKey);
            });

        } else if (state.allData[equipoKey]) {
            // Vieja Estructura: Acceso directo por key
            const oldObj = state.allData[equipoKey];
            columns = oldObj.columns || [];
            equipoData = oldObj.data || [];

            // Normalizar si es necesario
            if (equipoData.length > 0 && Array.isArray(equipoData[0])) {
                columns = equipoData[0];
                equipoData = processEquipoData(equipoData.slice(1), columns, equipoKey);
            } else if (oldObj.columns && oldObj.columns.length > 0) {
                columns = oldObj.columns;
            } else if (equipoData.length > 0) {
                columns = Object.keys(equipoData[0]);
            }
        }

        if (!equipoData || equipoData.length === 0) {
            resetState();
            clearKPIs(); // Limpiamos KPIs si no hay data específica, o podríamos dejarlos globales
            showEmptyState(`No hay datos disponibles para ${CONFIG.equipoNames[equipoKey]}`);

            // Aún así cargamos KPIs generales si existen datos globales
            if (state.allData.data && state.allData.data.length > 0) loadKPIs();
            return;
        }

        loadEquipoData(equipoData, columns, equipoKey);
    }

    function loadEquipoData(data, columns, equipoKey) {
        state.currentData = data;
        state.currentColumns = columns.length > 0 ? columns : (data.length > 0 ? Object.keys(data[0]) : []);

        // Asegurarnos de que cada fila tenga tipoEquipo para compatibilidad
        state.currentData = state.currentData.map(row => ({
            ...row,
            tipoEquipo: CONFIG.equipoNames[equipoKey] || equipoKey
        }));

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

    // ========== PROCESAMIENTO DE DATOS ==========

    /**
     * Procesa los datos crudos (matriz o array de objetos) para estandarizarlos.
     * 
     * @param {Array} data - Datos crudos del equipo.
     * @param {Array} columns - Nombres de las columnas.
     * @param {string} equipoKey - Identificador del equipo (e.g. 'rack', 'bca').
     * @returns {Array<Object>} Array de objetos con claves colX: valor.
     */
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
                return value.includes(searchTerm);
            })
        );
    }

    // ========== RENDERIZADO DE UI ==========

    /**
     * Actualiza los encabezados de la tabla.
     * @param {Array} columns - Nombres de las columnas
     */
    function updateTableHeaders(columns) {
        const thead = $('#tableHeaders');
        thead.empty();

        columns.forEach(col => {
            const headerText = capitalizeFirst(col);
            thead.append(`<th>${headerText}</th>`);
        });
    }

    function renderTable(data) {
        const tbody = $('#rutinariosTableBody');
        tbody.empty();

        if (data.length === 0) {
            showEmptyState('No se encontraron registros con los filtros aplicados.');
            return;
        }

        data.forEach((row, index) => {
            const tdElements = state.currentColumns.map(col =>
                createTableCell(col, row[col])
            ).join('');

            const rowId = row.ID || row.id || row.key || index;
            const isSelected = state.selectedRows.some(r => (r.ID || r.id || r.key) === (row.ID || row.id || row.key));
            const selectedClass = isSelected ? 'table-primary selected-row' : '';

            tbody.append(`<tr data-index="${index}" data-row-id="${rowId}" class="${selectedClass}">${tdElements}</tr>`);
        });
    }

    function createTableCell(columnName, value) {
        const colUpper = columnName.toUpperCase();
        const safeValue = escapeHtml(value || '');

        if (colUpper === 'ESTADO') {
            const badgeClass = getEstadoBadgeClass(value);
            return `<td><span class="badge ${badgeClass}">${safeValue}</span></td>`;
        }

        return `<td>${safeValue}</td>`;
    }

    function showEmptyState(message) {
        const tbody = $('#rutinariosTableBody');
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

    // ========== UTILIDADES ==========

    /**
     * Obtiene la clase CSS para el badge de estado.
     * @param {string} estado - Estado del equipo
     * @returns {string} Clase CSS de Bootstrap
     */
    function getEstadoBadgeClass(estado) {
        const estadoLower = (estado || '').toLowerCase();

        for (const [key, badgeClass] of Object.entries(CONFIG.estadoBadges)) {
            if (key !== 'default' && estadoLower.includes(key)) {
                return badgeClass;
            }
        }

        return CONFIG.estadoBadges.default;
    }

    function capitalizeFirst(str) {
        if (!str) return '';
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



    // ========== KPIs FUNCTIONS ==========

    /**
     * Orquestador principal para la carga y visualización de KPIs.
     * Verifica datos, invoca el cálculo y renderiza los gráficos.
     */
    async function loadKPIs() {
        try {
            if (!state.allData || Object.keys(state.allData).length === 0) {
                return;
            }

            const kpisData = calculateKPIsFromData();

            if (kpisData && Object.keys(kpisData).length > 0) {
                const response = {
                    done: true,
                    data: kpisData
                };

                const loaded = loadKPIData(response);
                if (loaded) {
                    renderKPICharts();
                }
            }
        } catch (error) {
            // Error silencioso en producción
        }
    }

    /**
     * Calcula las estadísticas de KPIs para el Dashboard.
     * Procesa los datos desde la hoja DATA y agrupa por tipo de equipo.
     * 
     * @returns {Object} Objeto con KPIs por equipo {rack: [[...], ...], bca: [...], tca: [...]}
     */
    function calculateKPIsFromData() {
        const kpis = {};

        // Intentar obtener datos de la fuente principal (DATA)
        let allRows = state.allData.data;
        if (!allRows || !Array.isArray(allRows)) {
            const dataSheet = state.allData.DATA ||
                Object.values(state.allData).find(s => s && s.data && Array.isArray(s.data));
            if (dataSheet && dataSheet.data) {
                allRows = dataSheet.data;
            }
        }

        // Iterar sobre cada tipo de equipo configurado
        for (const [key, name] of Object.entries(CONFIG.equipoNames)) {
            const upKey = key.toUpperCase();
            let totalEquipos = 0;
            let pendientes = 0;
            let enProgresoReal = 0;

            // 1. Calcular TOTAL desde allRows (DATA completa) filtrando por tipo de equipo
            if (allRows && Array.isArray(allRows) && allRows.length > 0) {
                allRows.forEach(row => {
                    const keys = Object.keys(row);
                    const eqKey = keys.find(k => k.toUpperCase() === 'EQUIPO') ||
                        keys.find(k => k.toUpperCase().includes('EQUIPO'));
                    const equipoRaw = String(eqKey && row[eqKey] !== null ? row[eqKey] : '').toUpperCase().trim();

                    let matches = false;
                    if (upKey === 'RACK') {
                        matches = equipoRaw.includes('RACK') || equipoRaw.includes('SISTEMA') || equipoRaw.includes('RESPALDO') || equipoRaw.includes('ELECTRICO');
                    } else {
                        matches = equipoRaw.includes(upKey);
                    }

                    if (matches) {
                        totalEquipos++;
                        // También contar pendientes desde aquí
                        const stKey = keys.find(k => k.toUpperCase() === 'ESTADO') ||
                            keys.find(k => k.toUpperCase().includes('ESTADO'));
                        const estado = String(stKey && row[stKey] !== null ? row[stKey] : '').trim();

                        if (estado === '') pendientes++;
                        else if (estado.toUpperCase().includes('PROGRESO')) enProgresoReal++;
                    }
                });
            }

            // 2. Si allRows no tiene datos, usar hojas individuales como fallback
            if (totalEquipos === 0) {
                const equipoSheet = state.allData[key];
                let equipoRows = [];
                if (equipoSheet) {
                    if (Array.isArray(equipoSheet.data)) equipoRows = equipoSheet.data;
                    else if (Array.isArray(equipoSheet)) equipoRows = equipoSheet;
                }

                equipoRows.forEach(row => {
                    const keys = Object.keys(row);
                    const stKey = keys.find(k => k.toUpperCase() === 'ESTADO') ||
                        keys.find(k => k.toUpperCase().includes('ESTADO'));
                    const estado = String(stKey && row[stKey] !== null ? row[stKey] : '').trim();

                    totalEquipos++;
                    if (estado === '') pendientes++;
                    else if (estado.toUpperCase().includes('PROGRESO')) enProgresoReal++;
                });
            }

            if (totalEquipos === 0) continue;

            const displayName = upKey === 'RACK' ? 'RACK' : name;
            const realizados = Math.max(0, totalEquipos - pendientes - enProgresoReal);

            kpis[key] = [
                [displayName, 'Data'],
                ['TOTAL EQUIPOS', totalEquipos],
                ['HABILITADOS', pendientes],
                ['EN PROGRESO', enProgresoReal],
                ['EJECUTADOS', realizados]
            ];
        }

        return kpis;
    }


    function loadKPIData(apiResponse) {
        if (!apiResponse || !apiResponse.data) return false;

        const cleanedData = {};

        for (const [equipoKey, equipoData] of Object.entries(apiResponse.data)) {
            if (Array.isArray(equipoData) && equipoData.length >= 5) {
                cleanedData[equipoKey] = equipoData.slice(1, 5);
            }
        }

        if (Object.keys(cleanedData).length === 0) return false;

        state.kpisData = cleanedData;
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

        // Ordenar y clasificar para el layout
        let sortedEntries = Object.entries(state.kpisData);
        let activeKey = state.currentEquipo ? state.currentEquipo.toLowerCase() : null;

        if (activeKey) {
            sortedEntries.sort(([keyA], [keyB]) => {
                if (keyA.toLowerCase() === activeKey) return -1;
                if (keyB.toLowerCase() === activeKey) return 1;
                return 0;
            });
        }

        sortedEntries.forEach(([equipoKey, equipoData]) => {
            const equipoName = CONFIG.equipoNames[equipoKey] || equipoKey;
            const chartId = `chart-${equipoKey}`;

            // Determinar layout según selección
            const isSelected = activeKey && equipoKey.toLowerCase() === activeKey;
            const colClass = activeKey
                ? (isSelected ? 'col-12 mb-3' : 'col-md-6 mb-3')
                : 'col-md-4 col-sm-12 mb-3';

            // Tamaño del canvas
            const canvasStyle = isSelected ? 'max-width: 300px; width: 100%;' : 'max-width: 180px; width: 100%;';
            const cardHeight = isSelected ? '' : 'h-100'; // Full height only for smaller cards

            const chartCard = $(`
                <div class="${colClass}">
                    <div class="card shadow-sm ${cardHeight}">
                        <div class="card-header bg-light text-dark text-center py-2">
                            <h6 class="mb-0 fw-bold">
                                ${equipoName}
                            </h6>
                        </div>
                        <div class="card-body p-2 d-flex flex-column justify-content-center align-items-center">
                            <div style="${canvasStyle}">
                                <canvas id="${chartId}"></canvas>
                            </div>
                        </div>
                        <div class="card-footer bg-white p-2">
                            <div class="row g-0 text-center x-small" id="stats-${equipoKey}">
                            </div>
                        </div>
                    </div>
                </div>
            `);

            container.append(chartCard);
            createPieChart(chartId, equipoKey, equipoData);
        });
    }

    function createPieChart(canvasId, equipoKey, data) {
        const kpiData = parseEquipoKPIData(data);

        if (!kpiData) return;

        const { total, pendientes, enProgreso, realizados } = kpiData;
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        const chart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Ejecutados', 'En Progreso', 'Habilitados'],
                datasets: [{
                    data: [realizados, enProgreso, pendientes],
                    backgroundColor: [
                        '#28a745', // Success/Green for Ejecutados (Realizados)
                        '#17a2b8', // Info/Blue for En Progreso
                        '#ffc107'  // Warning/Yellow for Habilitados
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
        if (!Array.isArray(data) || data.length < 4) return null;

        const total = parseInt(data[0][1]) || 0;
        const pendientes = parseInt(data[1][1]) || 0;
        const enProgreso = parseInt(data[2][1]) || 0;
        const realizados = parseInt(data[3][1]) || 0;

        return { total, pendientes, enProgreso, realizados };
    }

    function updateChartStats(equipoKey, kpiData) {
        const { total, pendientes, enProgreso, realizados } = kpiData;
        const percentage = total > 0 ? ((realizados / total) * 100).toFixed(1) : 0;

        const statsHtml = `
            <div class="col-3">
                <div class="text-muted" style="font-size: 0.7rem;">Total</div>
                <div class="fw-bold">${total}</div>
            </div>
            <div class="col-3">
                <div class="text-muted" style="font-size: 0.7rem;">Habil.</div>
                <div class="fw-bold text-warning">${pendientes}</div>
            </div>
            <div class="col-3">
                <div class="text-muted" style="font-size: 0.7rem;">En Prog.</div>
                <div class="fw-bold text-info">${enProgreso}</div>
            </div>
            <div class="col-3">
                <div class="text-muted" style="font-size: 0.7rem;">Ejec.</div>
                <div class="fw-bold text-success">${realizados}</div>
            </div>
            <div class="col-12 mt-2">
                <div class="progress" style="height: 10px;">
                    <div class="progress-bar bg-success" role="progressbar" 
                         style="width: ${percentage}%" 
                         aria-valuenow="${percentage}" 
                         aria-valuemin="0" 
                         aria-valuemax="100">
                    </div>
                </div>
                <div class="text-end mt-1 fw-bold text-success" style="font-size: 0.75rem;">${percentage}% Ejecutado</div>
            </div>
        `;

        $(`#stats-${equipoKey}`).html(statsHtml);
    }
    // ========== DOWNLOAD RUTINARIOS (ExcelJS) ==========

    /**
     * Genera y descarga un archivo Excel con los datos de mantenimientos rutinarios habilitados.
     * Filtra los registros según su estado e incluye una hoja de AVANCES con estadísticas.
     */
    async function downloadRutinarios() {
        if (!state.allData || Object.keys(state.allData).length === 0) {
            Salem.utils.toast({ title: 'Sin Datos', message: 'No hay datos cargados para descargar.', type: 'warning' });
            return;
        }

        await Salem.utils.loading({ title: 'Descargando', message: 'Generando archivo Excel profesional...' });

        try {
            // 1. Crear el Workbook manualmente para control total
            if (typeof ExcelJS === 'undefined') throw new Error('La librería ExcelJS no está cargada.');
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Salem';
            workbook.created = new Date();

            // 2. Generar Hoja de Avances (Dashboard)
            const summary = generateAvancesData();
            if (summary) {
                await addAvancesSheet(workbook, summary);
            }

            let totalRegistros = 0;

            // 3. Generar Hojas por Equipo
            if (state.allData.data && Array.isArray(state.allData.data)) {
                // NUEVA ESTRUCTURA: Filtrar desde main data
                const allRows = state.allData.data;

                for (const [key, name] of Object.entries(CONFIG.equipoNames)) {
                    // Filtrar y procesar cada equipo
                    const teamRows = allRows.filter(row => {
                        const eqVal = (row.equipo || row.EQUIPO || '').toString().toLowerCase();
                        return eqVal.includes(key);
                    });

                    if (teamRows.length === 0) continue;

                    // Filtrar por estados Habilitados
                    const filteredRows = teamRows.filter(row => {
                        const estado = (row.estado || row.ESTADO || '').toString().toUpperCase();
                        return estado.includes('HABILITADO') && !estado.includes('PROGRESO');
                    });

                    if (filteredRows.length === 0) continue;

                    // Preparar columnas
                    const cleanName = name.replace(/^\d+\.\s*/, '');
                    const worksheet = workbook.addWorksheet(cleanName.substring(0, 31));

                    // Definir columnas basadas en las llaves del objeto (que ya vienen del API)
                    const columns = Object.keys(filteredRows[0]);

                    // Setup headers
                    worksheet.columns = columns.map(k => ({ header: k.toUpperCase(), key: k, width: 15 }));
                    filteredRows.forEach(r => worksheet.addRow(r));

                    // Estilar encabezados
                    const headerRow = worksheet.getRow(1);
                    headerRow.eachCell(c => {
                        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
                        c.alignment = { horizontal: 'center' };
                    });

                    // Ajustar anchos
                    worksheet.columns.forEach(column => {
                        let maxColumnLength = 0;
                        column.eachCell({ includeEmpty: true }, (cell) => {
                            const columnLength = cell.value ? cell.value.toString().length : 10;
                            if (columnLength > maxColumnLength) maxColumnLength = columnLength;
                        });
                        column.width = maxColumnLength < 12 ? 12 : maxColumnLength + 2;
                    });

                    totalRegistros += filteredRows.length;
                }

            } else {
                for (const [key, equipoObj] of Object.entries(state.allData)) {
                    // Omitir la hoja CONFIG de las pestañas del Excel
                    if (key.toUpperCase() === 'CONFIG') continue;

                    const rawData = equipoObj.data || [];
                    if (rawData.length === 0) continue;

                    let sheetData = [];
                    let columns = [];

                    if (typeof rawData[0] === 'object' && !Array.isArray(rawData[0])) {
                        columns = Object.keys(rawData[0]);
                        sheetData = rawData;
                    } else if (Array.isArray(rawData[0])) {
                        columns = rawData[0];
                        sheetData = processEquipoData(rawData.slice(1), columns, key);
                    }

                    const estadoCol = columns.find(c => c && c.toString().toUpperCase().includes('ESTADO'));
                    if (estadoCol) {
                        sheetData = sheetData.filter(row => {
                            const estado = (row[estadoCol] || '').toString().toUpperCase();
                            return estado.includes('HABILITADO PARA MTTO RUTINARIO') &&
                                !estado.includes('PROGRESO MTTO PREVENTIVO');
                        });
                    }

                    const processedRows = sheetData.map(row => {
                        const cleanRow = {};

                        // Definir el orden deseado de las columnas principales
                        const mainColsOrder = ['ID', 'EQUIPO', 'ESTACION', 'UBICACION', 'ZONA', 'SUBZONA', 'ESTADO'];

                        // Primero agregar las columnas en el orden deseado
                        mainColsOrder.forEach(targetKey => {
                            Object.keys(row).forEach(k => {
                                if (k.toUpperCase().trim() === targetKey) {
                                    cleanRow[targetKey] = row[k];
                                }
                            });
                        });

                        // Luego agregar el resto de columnas que no están en el orden principal
                        Object.keys(row).forEach(k => {
                            const upperKey = k.toUpperCase().trim();
                            const isInternal = ['KEY', 'DEPLOYMENT', 'STATUS', 'INDEX', 'TICKET', 'TICKETS', ''].includes(upperKey);
                            if (!isInternal && !mainColsOrder.includes(upperKey)) {
                                cleanRow[upperKey] = row[k];
                            }
                        });

                        return cleanRow;
                    });

                    if (processedRows.length > 0) {
                        const equipoName = CONFIG.equipoNames[key] ? CONFIG.equipoNames[key].replace(/^\d+\.\s*/, '') : key;

                        // EVITAR CREAR PESTAÑA SI EL NOMBRE ES "DATA" O "CONFIG"
                        if (['DATA', 'CONFIG'].includes(equipoName.toUpperCase())) continue;

                        const worksheet = workbook.addWorksheet(equipoName.substring(0, 31));
                        const validKeys = Object.keys(processedRows[0]);

                        worksheet.columns = validKeys.map(k => ({ header: k, key: k, width: 15 }));
                        processedRows.forEach(r => worksheet.addRow(r));

                        // Estilar encabezados (Azul profesional como en el original)
                        const headerRow = worksheet.getRow(1);
                        headerRow.eachCell(c => {
                            c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
                            c.alignment = { horizontal: 'center' };
                        });

                        // Ajustar ancho de columnas automáticamente
                        worksheet.columns.forEach(column => {
                            let maxColumnLength = 0;
                            column.eachCell({ includeEmpty: true }, (cell) => {
                                const columnLength = cell.value ? cell.value.toString().length : 10;
                                if (columnLength > maxColumnLength) {
                                    maxColumnLength = columnLength;
                                }
                            });
                            column.width = maxColumnLength < 12 ? 12 : maxColumnLength + 2;
                        });

                        totalRegistros += processedRows.length;
                    }
                }
            }

            // 4. Descargar el archivo
            const fileName = `Pendientes_Mtto_Rutinario_${moment().format('YYYY-MM-DD_HHmm')}.xlsx`;
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.click();
            window.URL.revokeObjectURL(url);

            Salem.utils.toast({
                title: 'Descarga Completada',
                message: `Se descargaron ${totalRegistros} registros exitosamente con el dashboard de avance.`,
                type: 'success'
            });

        } catch (error) {
            console.error('Error al exportar:', error);
            Salem.utils.toast({ title: 'Error al Exportar', message: error.message, type: 'error' });
        } finally {
            await Salem.utils.loading();
        }
    }

    // ========== REPORT FUNCTIONALITY ==========

    /**
     * Abre el modal de reporte de novedades.
     * Carga el parcial HTML, lo inserta en el DOM y maneja el ciclo de vida del modal.
     */
    async function openReportModal() {
        // Reutiliza la utilidad de parciales de Salem
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
                const id = row.ID || row.id || row.key || 'N/A';
                const equipo = row.EQUIPO || row.equipo || 'N/A';
                const estacion = row.ESTACION || row.estacion || 'N/A';
                html += `<li><strong>${equipo} (${id})</strong> - Estación: ${estacion}</li>`;
            });
            html += '</ul>';

            if (reportEditor) {
                const currentData = reportEditor.getData();
                reportEditor.setData(currentData + html);
            }
        });

        // Manejo del envío
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

        // Limpieza de memoria al cerrar
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

            // Determinar saludo según la hora para el cuerpo del mensaje
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

    // ========== GENERACIÓN DE DATOS AVANCES ==========

    /**
     * Procesa los datos para generar estadísticas por Zona, Subzona y Equipo.
     * @returns {Object} Datos estructurados para el dashboard de "AVANCES"
     */
    function generateAvancesData() {
        if (!state.allData) return null;

        const summary = {
            global: { total: 0, realizados: 0, pendientes: 0 },
            porZona: {},
            porSubzona: {},
            porEquipo: {}
        };

        // 1. Usar la misma data que el Dashboard (objetos unificados si existen, si no buscar en DATA)
        let allRows = state.allData.data;
        if (!allRows || !Array.isArray(allRows)) {
            const dataSheet = state.allData.DATA || state.allData.data ||
                Object.values(state.allData).find(s => s && s.columns);
            if (dataSheet && dataSheet.data) {
                const cols = dataSheet.columns || [];
                allRows = dataSheet.data.map(r => {
                    if (typeof r === 'object' && !Array.isArray(r)) return r;
                    const obj = {};
                    cols.forEach((c, i) => obj[c.toUpperCase()] = r[i]);
                    return obj;
                });
            } else {
                return null;
            }
        }

        // Determinar Max Key para el Total Global
        let maxKey = 0;
        allRows.forEach(row => {
            const k = parseInt(row.key || row.KEY || row.ID || 0);
            if (!isNaN(k)) maxKey = Math.max(maxKey, k);
        });
        summary.global.total = maxKey || 2264;

        // 2. Procesar Filas para agrupar indicadores
        allRows.forEach((row, idx) => {
            const keys = Object.keys(row);

            // Priorización Quirúrgica de Columnas (Para evitar Ubicacion vs Zona)
            const eqKey = keys.find(k => k.toUpperCase() === 'EQUIPO') ||
                keys.find(k => k.toUpperCase() === 'TIPO_EQUIPO') ||
                keys.find(k => k.toUpperCase().includes('EQUIPO'));

            // Priorizar ZONA sobre UBICACION
            const znKey = keys.find(k => k.toUpperCase() === 'ZONA') ||
                keys.find(k => k.toUpperCase() === 'ZONAS') ||
                keys.find(k => k.toUpperCase().includes('ZONA'));

            const sbKey = keys.find(k => k.toUpperCase() === 'SUBZONA') ||
                keys.find(k => k.toUpperCase() === 'SUB-ZONA') ||
                keys.find(k => k.toUpperCase().includes('SUBZONA')) ||
                keys.find(k => k.toUpperCase().includes('VAGON'));

            // Estado: Buscar específicamente el campo que suele estar vacío para los faltantes
            const stKey = keys.find(k => k.toUpperCase() === 'ESTADO') ||
                keys.find(k => k.toUpperCase() === 'ESTADO MTTO') ||
                keys.find(k => k.toUpperCase().includes('ESTADO')) ||
                keys.find(k => k.toUpperCase() === 'ST') ||
                keys.find(k => k.toUpperCase().includes('STATUS'));

            // Extraer Valores
            const equipoRaw = String(eqKey && row[eqKey] !== null ? row[eqKey] : '').toUpperCase().trim();
            const zona = String(znKey && row[znKey] !== null ? row[znKey] : 'OTRA').toUpperCase().trim();
            const subzona = String(sbKey && row[sbKey] !== null ? row[sbKey] : 'OTRA').toUpperCase().trim();
            const estado = String(stKey && row[stKey] !== null ? row[stKey] : '').trim();

            // Filtrar filas inválidas o administrativas
            if (!equipoRaw || ['DATA', 'CONFIG', 'RESUMEN', 'LOG'].includes(equipoRaw)) return;

            // Mapeo unificado de Equipos (Filtros del usuario)
            let category = 'OTROS';
            if (equipoRaw.includes('RACK') || equipoRaw.includes('SISTEMA') || equipoRaw.includes('RESPALDO') || equipoRaw.includes('ELECTRICO')) category = 'RACK';
            else if (equipoRaw.includes('BCA')) category = 'BCA';
            else if (equipoRaw.includes('TCA')) category = 'TCA';
            else category = equipoRaw;

            // Determinar si es faltante (estado vacío)
            const isFaltante = (estado === '');

            // Inicializar contadores si no existen
            if (!summary.porEquipo[category]) summary.porEquipo[category] = { total: 0, realizados: 0, pendientes: 0 };
            if (!summary.porZona[zona]) summary.porZona[zona] = { total: 0, realizados: 0, pendientes: 0 };
            const subKey = `${zona}|${subzona}`;
            if (!summary.porSubzona[subKey]) summary.porSubzona[subKey] = { zona, subzona, total: 0, realizados: 0, pendientes: 0 };

            // Incrementar Totales (Censo)
            summary.porEquipo[category].total++;
            summary.porZona[zona].total++;
            summary.porSubzona[subKey].total++;

            if (isFaltante) {
                summary.global.pendientes++;
                summary.porEquipo[category].pendientes++;
                summary.porZona[zona].pendientes++;
                summary.porSubzona[subKey].pendientes++;
            } else {
                summary.porEquipo[category].realizados++;
                summary.porZona[zona].realizados++;
                summary.porSubzona[subKey].realizados++;
            }
        });

        // Calcular totales globales basados en el conteo real
        summary.global.total = Object.values(summary.porEquipo).reduce((s, a) => s + a.total, 0);
        summary.global.realizados = Math.max(0, summary.global.total - summary.global.pendientes);

        return summary;
    }

    /**
     * Agrega una hoja de "AVANCES" estilizada al workbook.
     * @param {ExcelJS.Workbook} workbook 
     * @param {Object} summary - Datos calculados en generateAvancesData.
     */
    async function addAvancesSheet(workbook, summary) {
        const ws = workbook.addWorksheet('AVANCES', { views: [{ showGridLines: false }] });

        // Estilos base
        const theme = {
            purple: 'FF4C2C69',
            lightPurple: 'FFE4DDF2',
            white: 'FFFFFFFF',
            border: {
                top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
                left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
                bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
                right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
            }
        };

        // 1. Título y Logo
        ws.mergeCells('B2:E4'); // Ampliar rango para título
        const titleCell = ws.getCell('B2');

        // Configuración de meses en español (Arrays indexados 0-11)
        const meses = [
            'ENERO', 'FEBRERO', 'MARZO', 'ABRIL',
            'MAYO', 'JUNIO', 'JULIO', 'AGOSTO',
            'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
        ];
        // Usar moment().month() (0-11) para obtener el nombre correcto sin depender del idioma de moment
        const mesActual = meses[moment().month()] || moment().format('MMMM').toUpperCase();

        titleCell.value = '                  Salem\n                  Dashboard General de Gestión - Rutinarios\n                  ' + mesActual + ' ' + moment().year();
        titleCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        titleCell.font = { size: 12, bold: true };

        // Intentar insertar Logo
        try {
            // Nota: La ruta debe ser relativa al archivo HTML que ejecuta el script o absoluta en el servidor/extensión
            const response = await fetch('../../../../../icons/salem_64x64.png');
            if (response.ok) {
                const buffer = await response.arrayBuffer();
                const imageId = workbook.addImage({
                    buffer: buffer,
                    extension: 'png',
                });
                ws.addImage(imageId, {
                    tl: { col: 1.1, row: 1.1 }, // Dentro de B2
                    ext: { width: 60, height: 60 }
                });
            }
        } catch (error) {
            console.warn('No se pudo insertar el logo en Excel:', error);
        }

        // 2. Resumen Global (Total vs Intervenidos vs Faltantes)
        ws.getCell('F2').value = 'Total equipos';
        ws.getCell('G2').value = 'Intervenidos';
        ws.getCell('H2').value = 'Faltantes';

        ws.getCell('F3').value = summary.global.total;
        ws.getCell('G3').value = summary.global.realizados;
        ws.getCell('H3').value = Math.max(0, summary.global.total - summary.global.realizados);

        ['F2', 'G2', 'H2'].forEach(c => {
            const cell = ws.getCell(c);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA6A6A6' } };
            cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
            cell.alignment = { horizontal: 'center' };
        });
        ['F3', 'G3', 'H3'].forEach(c => {
            const cell = ws.getCell(c);
            cell.font = { size: 14, bold: true };
            cell.alignment = { horizontal: 'center' };
            cell.border = theme.border;
        });

        // 3. Tablas de Estadísticas con fila de TOTALES
        const drawTable = (startRow, startCol, title, headers, dataRows) => {
            const headerRange = `${String.fromCharCode(64 + startCol)}${startRow}:${String.fromCharCode(64 + startCol + headers.length - 1)}${startRow}`;
            ws.mergeCells(headerRange);
            const head = ws.getCell(startRow, startCol);
            head.value = title;
            head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.purple } };
            head.font = { color: { argb: theme.white }, bold: true };
            head.alignment = { horizontal: 'center' };

            const subHeadRow = ws.getRow(startRow + 1);
            headers.forEach((h, i) => {
                const cell = subHeadRow.getCell(startCol + i);
                cell.value = h;
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA6A6A6' } };
                cell.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
                cell.alignment = { horizontal: 'center' };
            });

            // DATA
            dataRows.forEach((row, i) => {
                const r = ws.getRow(startRow + 2 + i);
                row.forEach((val, j) => {
                    const cell = r.getCell(startCol + j);
                    cell.value = val;
                    if (headers[j].includes('Avance')) {
                        cell.numFmt = '0.00%';
                    }
                    cell.border = theme.border;
                    cell.alignment = { horizontal: j === 0 ? 'left' : 'center' };
                });
            });

            // TOTALES ROW - Usar valores globales para mayor precisión
            const totalRowIndex = startRow + 2 + dataRows.length;
            const totalRow = ws.getRow(totalRowIndex);

            // Etiqueta TOTALES
            const titleCell = totalRow.getCell(startCol);
            titleCell.value = 'TOTALES';
            titleCell.font = { bold: true };
            titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
            titleCell.border = theme.border;

            // Determinar qué totales usar (Si es la tabla de equipos, usamos el global exacto)
            const isEquipos = title.toLowerCase().includes('equipo');
            const isZonas = title.toLowerCase().includes('zona');

            let finalTotal = 0;
            let finalRealizados = 0;
            let finalPendientes = 0;

            if (isEquipos || isZonas) {
                finalTotal = summary.global.total;
                finalRealizados = summary.global.realizados;
                finalPendientes = summary.global.pendientes;
            } else {
                dataRows.forEach(r => {
                    const offset = r.length === 6 ? 2 : 1;
                    finalTotal += (r[offset] || 0);
                    finalRealizados += (r[offset + 1] || 0);
                    finalPendientes += (r[offset + 2] || 0);
                });
            }

            const colOffset = dataRows[0] && dataRows[0].length === 6 ? 2 : 1;

            // Celda Equipos
            const cellEq = totalRow.getCell(startCol + colOffset);
            cellEq.value = finalTotal;
            cellEq.font = { bold: true };
            cellEq.border = theme.border;
            cellEq.alignment = { horizontal: 'center' };
            cellEq.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };

            // Celda Realizados
            const cellRe = totalRow.getCell(startCol + colOffset + 1);
            cellRe.value = finalRealizados;
            cellRe.font = { bold: true };
            cellRe.border = theme.border;
            cellRe.alignment = { horizontal: 'center' };
            cellRe.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };

            // Celda Faltantes
            const cellFa = totalRow.getCell(startCol + colOffset + 2);
            cellFa.value = finalPendientes;
            cellFa.font = { bold: true };
            cellFa.border = theme.border;
            cellFa.alignment = { horizontal: 'center' };
            cellFa.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };

            // Celda Avance
            const cellAv = totalRow.getCell(startCol + colOffset + 3);
            const totalAvance = finalTotal > 0 ? finalRealizados / finalTotal : 0;
            cellAv.value = totalAvance;
            cellAv.numFmt = '0.00%';
            cellAv.font = { bold: true };
            cellAv.border = theme.border;
            cellAv.alignment = { horizontal: 'center' };
            cellAv.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };

            // Si hay columna extra (Subzona), llenar el hueco
            if (colOffset === 2) {
                const cellEmpty = totalRow.getCell(startCol + 1);
                cellEmpty.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
                cellEmpty.border = theme.border;
            }
        };

        // Preparar datos para Zonas
        let zonaData = Object.entries(summary.porZona).map(([zona, stats]) => {
            const faltantes = Math.max(0, stats.total - stats.realizados);
            const avance = stats.total > 0 ? stats.realizados / stats.total : 0;
            return [zona, stats.total, stats.realizados, faltantes, avance];
        });

        // No agregamos filas de balanceo automáticas ("REALIZADOS / OTROS") 
        // ya que confiamos en que DATA contiene el censo total de equipos.
        // Si hay diferencia, se verá reflejada en el Total vs Suma de zonas.

        // Ordenar alfabéticamente
        zonaData.sort((a, b) => a[0].localeCompare(b[0]));

        drawTable(6, 2, 'Pendientes por zona', ['Zonas', 'Equipos', 'Realizados', 'Faltantes', 'Avance'], zonaData);

        // Preparar datos para Equipos
        let equipoData = Object.entries(summary.porEquipo).map(([eq, stats]) => {
            const faltantes = Math.max(0, stats.total - stats.realizados);
            const avance = stats.total > 0 ? stats.realizados / stats.total : 0;
            return [eq, stats.total, stats.realizados, faltantes, avance];
        });

        drawTable(6, 9, 'Pendientes por equipo', ['Equipo', 'Equipos', 'Realizados', 'Faltantes', 'Avance'], equipoData);


        // Preparar datos para Subzonas
        const allSubzonas = Object.values(summary.porSubzona).sort((a, b) => b.total - a.total);
        let subzonaData = allSubzonas.map(s => {
            const faltantes = Math.max(0, s.total - s.realizados);
            const avance = s.total > 0 ? s.realizados / s.total : 0;
            return [s.zona, s.subzona, s.total, s.realizados, faltantes, avance];
        });
        drawTable(14, 9, 'Pendientes por subzona', ['Zona', 'Subzona', 'Equipos', 'Interven.', 'Faltantes', 'Avance'], subzonaData);

        // Indicador principal de Avance
        const totalAvance = summary.global.total > 0 ? summary.global.realizados / summary.global.total : 0;
        // RESTRINGIDO A G7:H12 para evitar solapamiento con tablas B:F e I:N
        ws.mergeCells('G7:H12');
        const bigCell = ws.getCell('G7');
        bigCell.value = totalAvance;
        bigCell.numFmt = '0.00%';
        bigCell.font = { size: 36, bold: true, color: { argb: theme.purple } }; // Tamaño ajustado para celdas G:H
        bigCell.alignment = { vertical: 'middle', horizontal: 'center' };
        bigCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.lightPurple } };

        // Ajustar anchos Dashboard para evitar #####
        for (let i = 2; i <= 13; i++) {
            ws.getColumn(i).width = 16;
        }
        ws.getColumn(2).width = 25; // Zonas
        ws.getColumn(9).width = 25; // Equipos / Subzonas
        ws.getColumn(1).width = 2;  // Margen izquierdo
    }
});
