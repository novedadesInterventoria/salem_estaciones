$(async () => {
    let idSelector = null
    let panel = await Salem.utils.partials.get('/sources/popup/menus/planes/create/simple.html', {})
    let estaciones = []
    storage.config.otrs.CMDB.forEach(fila => {
        let match = estaciones.find(u => u.name == fila.estacion)
        if (!match) estaciones.push({ name: fila.estacion })
    })

   

    estaciones.sort((a, b) => b.name - a.name)
    new TomSelect($(panel).find('[name="estacion"]'), {
        valueField: 'name', labelField: 'name', searchField: 'name', options: estaciones,
        onChange: setEquipos,
       
    })

    /**
     * Carga de técnicos delegada al módulo compartido _tecnicos.js.
     * Estrategia: cache-first + MutationObserver + retry exponencial en background.
     * El observer espera a que [name="tcampo"] exista en el panel antes de montar TomSelect.
     */
    SalemTecnicos.init(panel)

    /**
     * @description Filtra y actualiza el selector de equipos (TomSelect) según la estación seleccionada.
     * Aplica el filtro activo si existe y reinicia los campos de índice y costado.
     *
     * @returns {void}
     */
    function setEquipos() {
        let [estacion] = this.items
        let equipos = storage.config.otrs.CMDB.filter(u => u.estacion == estacion).map(fila => {
            return { index: fila.index, name: `${fila.equipo} ${fila.name}` }
        })

        // Verificar si existe el parámetro de filtro
        let filtro = $('[name="filtro"]').val()
        if (filtro) equipos = equipos.filter(u => u.name.includes(filtro))

        if (idSelector) idSelector.destroy()
        idSelector = new TomSelect($(panel).find('[name="id"]'), {
            valueField: 'index', labelField: 'name', searchField: 'name', options: equipos,
            onChange: setCostado, items: []
        })
        $('[name="index"]').val('')
        $('[name="costado"]').val('')
    }

    /**
     * @description Obtiene la ubicación/costado del equipo seleccionado en la CMDB y actualiza
     * el campo visual correspondiente y el input index del formulario.
     *
     * @returns {void}
     */
    function setCostado() {
        let [index] = this.items
        let regitro = storage.config.otrs.CMDB.find(u => u.index == index)
        $('[name="costado"]').val(regitro ? (regitro.ubicacion || '') : '')
        $('[name="index"]').val(JSON.stringify(this.items))
    }

    /**
     * @description Obtiene la hora actual del reloj local del PC en formato HH:mm
     * y la asigna al campo de hora en el formulario de creación (completamente editable).
     *
     * @returns {void}
     */
    function setHoraActual() {
        const ahora = new Date()
        const hh = String(ahora.getHours()).padStart(2, '0')
        const mm = String(ahora.getMinutes()).padStart(2, '0')
        $(panel).find('[name="hora"]').val(`${hh}:${mm}`)
    }

    $(panel).find('[name="progresar"]').on('change', toggleSweep)
    /**
     * @description Conmuta la visibilidad y activación del editor de plantilla (ClassicEditor)
     * y del campo de hora según el valor del selector `progresar` ('SI' o 'NO').
     *
     * @returns {Promise<void>}
     */
    async function toggleSweep() {
        let val = $(this).val()
        if (val == 'SI') {
            editorPanel = await ClassicEditor.create($('div#editor')[0], { placeholder: 'Ingrese la plantilla del técnico aquí.' })
            $('[name="hora"]').attr('required', 'required')
            $('[name="hora"]').closest('.col').removeClass('d-none')
            setHoraActual()
        }
        else {
            editorPanel = null
            $('[data-tag="editorPanel"]').html('<div id="editor"></div>')
            $('[name="hora"]').removeAttr('required')
            $('[name="hora"]').closest('.col').addClass('d-none')
        }
    }
    $('#create').html(panel)

    // [REQ 3] Los tickets normalmente quedan "En progreso":
    // Preseleccionar "SI" y activar el editor/hora por defecto al abrir el panel.
    // Se usa el selector sobre el DOM vivo (ya insertado) para garantizar la activación.
    $('#create [name="progresar"]').val('SI').trigger('change')
})