$(() => {
    // Colocar enlace
    $('[data-link="recovery"]').attr('href', Salem.rules.api.prod)
    $('[data-link="manual"]').attr('href', Salem.rules.api.manual)
    let p = new URLSearchParams(window.location.search)
    let needsBack = p.get('back')

    $('form#login').submit(async e => {
        e.preventDefault()
        let data = Salem.utils.getFormValues(e)
        data.hash = CryptoJS.SHA256(data.hash).toString()
        await Salem.utils.loading({ title: 'Comprobando credenciales', message: 'Por favor espere mientras se comprueban sus credenciales.' })
        let res = await Salem.core.api({ action: 'login', subaction: 'init', ...data })
        if (res.length) {
            await Salem.utils.loading({ title: 'Sincronizando', message: 'Salem está cargando datos estructurales, por favor espere.' })
            let config = await Salem.core.runtime.sync()
            config.login = res[0]
            await Salem.core.mem.set(config)
            needsBack == 'true' ? window.location.href = Salem.rules.routes.otrs : window.close()
        }
        else {
            await Salem.utils.loading()
            Salem.utils.toast({ title: 'Login fallido', message: 'Combinación de usuario y contraseña rechazados por el API.', type: 'error' })
        }
    })
})