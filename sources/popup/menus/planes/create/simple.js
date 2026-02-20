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

    await Salem.utils.loading({ title: 'Obteniendo técnicos', message: 'Se está consultando el listado de técnicos disponibles en OTOBO.' })
    let queryAjax = await Salem.otrs.ajax({ Action: 'AgentTicketNote', Subaction: 'AJAXUpdate', ElementChanged: 'DynamicField_QUIENGESTIONA', TicketID: '943890', transform: 'json' })
    let tecnicos = queryAjax.DynamicField_QUIENGESTIONA.map(u => {
        return { name: u[0] }
    })
    new TomSelect($(panel).find('[name="tcampo"]'), {
        valueField: 'name', labelField: 'name', searchField: 'name', options: tecnicos
    })
    Salem.utils.loading()

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

    function setCostado() {
        let [index] = this.items
        let regitro = storage.config.otrs.CMDB.find(u => u.index == index)
        $('[name="costado"]').val(regitro.ubicacion)
        $('[name="index"]').val(JSON.stringify(this.items))
    }

    $(panel).find('[name="progresar"]').on('change', toggleSweep)
    async function toggleSweep() {
        let val = $(this).val()
        if (val == 'SI') {
            editorPanel = await ClassicEditor.create($('div#editor')[0], { placeholder: 'Ingrese la plantilla del técnico aquí.' })
            $('[name="hora"]').attr('required', 'required')
            $('[name="hora"]').closest('.col').removeClass('d-none')
        }
        else {
            editorPanel = null
            $('[data-tag="editorPanel"]').html('<div id="editor"></div>')
            $('[name="hora"]').removeAttr('required')
            $('[name="hora"]').closest('.col').addClass('d-none')
        }
    }
    $('#create').html(panel)
})