$(async () => {

    let equipoSelector = null
    let idSelector = null
    let panel = await Salem.utils.partials.get('/sources/popup/menus/planes/create/bulk.html', {})
    let estaciones = []

    storage.config.otrs.CMDB.forEach(fila => {
        let match = estaciones.find(u => u.name == fila.estacion)
        if (!match) estaciones.push({ name: fila.estacion })
    })

   

    estaciones.sort((a, b) => b.name - a.name)
    let estacionSelector = new TomSelect($(panel).find('[name="estacion"]'), {
        valueField: 'name', labelField: 'name', searchField: 'name', options: estaciones,
        onChange: setTipos
    })

    /**
     * Carga de técnicos delegada al módulo compartido _tecnicos.js.
     * Estrategia: cache-first + MutationObserver + retry exponencial en background.
     * El observer espera a que [name="tcampo"] exista en el panel antes de montar TomSelect.
     */
    SalemTecnicos.init(panel)

    /**
     * @description Actualiza el selector de tipos de equipo según la estación seleccionada.
     * Aplica el filtro activo si existe el campo `filtro` en el formulario.
     * Se invoca como callback onChange del TomSelect de estaciones.
     *
     * @returns {void}
     */
    function setTipos() {
        let [estacion] = this.items
        let equipos = storage.config.otrs.CMDB.filter(u => u.estacion == estacion).map(fila => {
            return { name: fila.equipo }
        })

        // Verificar si existe el parámetro de filtro
        let filtro = $('[name="filtro"]').val()
        if (filtro) equipos = equipos.filter(u => u.name.includes(filtro))

        if (equipoSelector) equipoSelector.destroy()
        equipoSelector = new TomSelect($(panel).find('[name="tipo"]'), {
            valueField: 'name', labelField: 'name', searchField: 'name', options: equipos,
            onChange: setEquipos, items: []
        })
        $('[name="index"]').val('')
    }

    /**
     * @description Actualiza el selector de equipos individuales según los tipos seleccionados en el filtro de tipo.
     * Consulta la CMDB filtrada por estación y tipo. Reinicia el selector de índice.
     * Se invoca como callback onChange del TomSelect de tipos.
     *
     * @returns {void}
     */
    function setEquipos() {
        let tipos = this.items
        let estacion = estacionSelector.getValue()
        let equipos = storage.config.otrs.CMDB.filter(u => tipos.indexOf(u.equipo) != -1 && u.estacion == estacion).map(u => {
            return { index: u.index, name: `${u.equipo} ${u.name} ${u.ubicacion}` }
        })
        if (idSelector) idSelector.destroy()
        idSelector = new TomSelect($(panel).find('[name="id"]'), {
            valueField: 'index', labelField: 'name', searchField: 'name', options: equipos,
            items: [], onChange: setIndex
        })
        $('[name="index"]').val('')
    }

    /**
     * @description Serializa los índices seleccionados en el TomSelect de equipos como JSON
     * en el campo oculto `[name="index"]` del formulario de creación.
     * Se invoca como callback onChange del TomSelect de equipos individuales.
     *
     * @returns {void}
     */
    function setIndex() {
        $('[name="index"]').val(JSON.stringify(this.items))
    }

    $('#create').html(panel)
})