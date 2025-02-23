$(async () => {
    let info = await Salem.core.runtime.getInfo()
    let idEquipo = info['ID Móvil'] || info['ID Equipo']
    let ubicacion = info.Patio || info['Estación'] || info['Ubicación Infraestructura Física y Locativa'] || info['Ubicación Punto de Personalización']
    let falla = info['Requerimiento de Soporte Técnico'].includes('RUTINARIO') ? 'EJECUCION DE MANTENIMIENTO RUTINARIO' : 'EJECUCION DE MANTENIMIENTO PREVENTIVO'
    let closeParams = storage.config.otrs.CLOSE.find(u => u.servicio == info.Servicio && u.falla == falla)

    $('form#closeTickets [name="rotulo"]').val(info.rotulo)
    $('form#closeTickets [name="equipo"]').val(idEquipo)
    $('form#closeTickets [name="ubicacion"]').val(ubicacion)
    $('form#closeTickets [name="tcampo"]').val(info['¿Quién Gestiona?'])
    $('form#closeTickets [name="falla"]').val(falla)

    let closeEditor = await ClassicEditor.create($('form#closeTickets #closeEditor')[0], { placeholder: 'Ingrese la plantilla del técnico aquí.' })

    $('form#closeTickets').submit(async e => {
        e.preventDefault()
        let data = Salem.utils.getFormValues(e)
        data.cuerpo = closeEditor.getData()
        if (data.cuerpo.length >= 10) {
            await Salem.utils.loading({title: 'Resolviendo ticket', message: 'Por favor espere mientras se cierra este ticket.'})
            let closeForm = await Salem.otrs.ajax({ Action: 'AgentTicketClose', TicketID: info.id, transform: 'form' })
            let asunto = `RESUELTO ${data.hora}`
            let completeForm = Salem.otrs.utils.predef.close.estaciones(closeForm, { ...data, firma: storage.login.firma, asunto, atencion: 'PRESENCIAL' }, closeParams)
            
            // Enviar el cierre
            await Salem.otrs.ajax(completeForm)
            let middleware = await Salem.otrs.middleware({isState: 'RESUELTO'})
            if(middleware){
                await Salem.utils.loading({title: 'Validando por aseguramiento', message: 'Se está cambiando al estado VALIDADO POR ASEGURAMIENTO.'})
                completeForm.NewStateID = '42' // VALIDADO POR ASEGURAMIENTO
                completeForm.Subject = 'VALIDADO POR ASEGURAMIENTO' // VALIDADO POR ASEGURAMIENTO
                completeForm.Body = 'VALIDADO POR ASEGURAMIENTO' // VALIDADO POR ASEGURAMIENTO
                delete completeForm.IsVisibleForCustomer
                await Salem.otrs.ajax(completeForm)
                await Salem.core.runtime.reload()
                window.close()
            }
        }
        else {
            Salem.utils.toast({ title: 'Nota de cierre incompleta', message: 'El texto ingresado es muy corto.', type: 'error', noHide: true })
        }
    })
})