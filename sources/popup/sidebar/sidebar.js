var storage = null
$(async () => {
    await Salem.utils.loading({ title: 'Cargando paneles', message: 'Por favor espere mientras Salem prepara los paneles.' })
    const tooltipTriggerList = Array.from(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
    tooltipTriggerList.forEach(tooltipTriggerEl => {
        new bootstrap.Tooltip(tooltipTriggerEl)
    })
    storage = await Salem.core.mem.get()
    $('[data-tag="gravatar"]').attr('src', `https://www.gravatar.com/avatar/${CryptoJS.MD5(storage.login.correo).toString()}?d=https://icons.veryicon.com/png/o/miscellaneous/two-color-icon-library/user-286.png`)
    $('[data-tag="username"]').text(storage.login.usuario)
    $('[data-tag="cargo"]').text(storage.login.area)
    setPreferPanel()
})

$('[data-tag="salemSidebarToggle"]').click(salemSidebarToggle)
salemSidebarToggle(null, true)
async function salemSidebarToggle(event, isAuto) {
    let storage = await Salem.core.mem.get()
    if (typeof storage == 'undefined') {
        Salem.utils.router(Salem.core.routes.login)
    }
    else {
        if (typeof storage.sidebar == 'undefined') {
            // Si no existe se agrega como true
            $('.sidebar').addClass('d-none')
            storage.sidebar = false
        }
        else {
            storage.sidebar = isAuto ? storage.sidebar : !storage.sidebar
            storage.sidebar == true ? $('.sidebar').removeClass('d-none') : $('.sidebar').addClass('d-none')
        }
    }
    await Salem.core.mem.set(storage)
}

async function setPreferPanel(panel) {
    try {
        $('.notify__close').click()
        if (typeof panel == 'undefined') {
            await Salem.utils.partials.getSetPanel(storage.login.config.defaultPanel)
        }
        else {
            await Salem.utils.partials.getSetPanel(panel)
        }
    } catch (error) {
        await Salem.utils.partials.getSetPanel('error')
    }
}

$('[data-sidebar-panel').click(u => {
    let action = $(u.currentTarget).data('sidebarPanel')
    if(action == 'killSession'){
        Salem.core.mem.clear()
        window.close()
    }
    setPreferPanel(action)
})
