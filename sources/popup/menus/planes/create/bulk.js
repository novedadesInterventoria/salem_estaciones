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

    await Salem.utils.loading({ title: 'Obteniendo técnicos', message: 'Se está consultando el listado de técnicos disponibles en OTOBO.' })
    let queryAjax = await Salem.otrs.ajax({ Action: 'AgentTicketNote', Subaction: 'AJAXUpdate', ElementChanged: 'DynamicField_QUIENGESTIONA', TicketID: '943890',  transform: 'json' })
    let tecnicos = queryAjax.DynamicField_QUIENGESTIONA.map(u => {
        return { name: u[0] }
    })
    new TomSelect($(panel).find('[name="tcampo"]'), {
        valueField: 'name', labelField: 'name', searchField: 'name', options: tecnicos
    })
    Salem.utils.loading()

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

    function setIndex() {
        $('[name="index"]').val(JSON.stringify(this.items))
    }

    $('#create').html(panel)
})