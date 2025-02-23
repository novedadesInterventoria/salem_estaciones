$(async () => {
    let info = await Salem.core.runtime.getInfo()
    let cat = info['Categoría del Ticket'].includes('FLOTA') ? 'buses' : 'no_buses'
    if (storage.config.sweep[cat].arbol_estados[info.Estado]) {
        let jumps = storage.config.sweep[cat].arbol_estados[info.Estado].cross.map(u => { return { estado: u } })
        $('form#sweep [name="inicio"]').val(info.Estado)
        new TomSelect($('form#sweep [name="destino"]'), {
            valueField: 'estado', searchField: 'estado', labelField: 'estado', options: jumps, maxItems: 1, closeAfterSelect: true,
            openOnFocus: true, selectOnTab: true, items: storage.config.sweep[cat].arbol_estados[info.Estado].destino
        })

        let idEquipo = info['ID Móvil'] || info['ID Equipo']
        let ubicacion = info.Patio || info['Estación'] || info['Ubicación Infraestructura Física y Locativa'] || info['Ubicación Punto de Personalización']

        $('form#sweep [name="equipo"]').val(idEquipo)
        $('form#sweep [name="ubicacion"]').val(ubicacion)
        $('form#sweep [name="tcampo"]').val(info['¿Quién Gestiona?'])

        let sweepEditorV = await ClassicEditor.create($('form#sweep #sweepEditor')[0], {placeholder: 'Ingrese la plantilla del técnico aquí.'})

        $('form#sweep').submit(async e => {
            e.preventDefault()
            let middleware = await Salem.otrs.middleware(['isSameState'])
            if (middleware) {
                let data = Salem.utils.getFormValues(e)
                data.nota = sweepEditorV.getData()
                let sweep = await Salem.core.runtime.sweep(info, data)
                if(sweep){
                    await Salem.core.emit({action: 'reload'})
                    let clipboard = `Ticket# ${info.ticket} — ${info.rotulo}\n${data.destino} OK ${storage.login.firma}`
                    await Salem.utils.clipboard(clipboard)
                    window.close()
                }
            }
        })
    }
    else {
        Salem.utils.modalError({ title: 'Estado de ticket no soportado', message: `El estado del ticket ${info.Estado} en la categoría ${info['Categoría del Ticket']} no está soportado para relizar traza de estados.` })
    }
})