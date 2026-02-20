$(() => {
    let tipo = ''
    $('[name="plan"]').on('change', changePrevType)
    
    function changePrevType() {
        tipo = $(this).val()
        $('input[name="asunto"]').val(storage.config.planes.active[tipo])
        $('[data-tag="planContainer"]').removeClass('d-none')
        $('[data-tag="plan"]').text(storage.config.planes.active[tipo])
    }

    $('#downloadMpp').submit(async e => {
        e.preventDefault()
        let data = Salem.utils.getFormValues(e)
        await Salem.utils.loading({ title: 'Consultando', message: 'Se está obteniendo la información de Salem. Por favor espere ...' })
        
        let jsonRes;
        
        // Determinar qué API llamar según el tipo de plan seleccionado
        if (tipo === 'contractual') {
            console.log({ action: 'pendientes', subaction: 'preventivos', plan: data.asunto, config: storage.config.planes });
            jsonRes = await Salem.core.api({ action: 'pendientes', subaction: 'preventivos', plan: data.asunto, config: storage.config.planes })
        } else if (tipo === 'contractualTemporales') {
            console.log({ action: 'pendientes', subaction: 'preventivosTemporales', plan: data.asunto, config: storage.config.planes });
            jsonRes = await Salem.core.api({ action: 'pendientes', subaction: 'preventivosTemporales', plan: data.asunto, config: storage.config.planes })
        }
        
        // Procesar los datos y generar el archivo Excel
        if (jsonRes) {
            jsonRes.forEach(u => { 
                delete u.key; 
                delete u.deployment; 
                delete u.status; 
                delete u.index; 
            })
            
            let ws = XLSX.utils.json_to_sheet(jsonRes);
            let wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Pendientes");
            XLSX.writeFile(wb, `Pendientes ${data.asunto} ${moment().format('DD-MM-YYYY HH_mm')}.xlsx`);
        }
        
        await Salem.utils.loading()
    })
})