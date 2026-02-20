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
/**
 * @description Alterna la visibilidad del panel de navegación lateral (sidebar) de Salem.
 * Si el storage no está disponible, redirige al login. En modo automático (`isAuto = true`),
 * respeta el estado guardado en memoria sin invertirlo.
 *
 * @param {MouseEvent|null} event  - Evento de clic del botón toggle, o null en la invocación automática al iniciar.
 * @param {boolean}         isAuto - Indica si la invocación es automática (al cargar la página) o por acción del usuario.
 *
 * @returns {Promise<void>}
 */
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

/**
 * @description Carga el panel solicitado y restaura la CMDB original si se navega fuera de fiscalizadores.
 *
 * @param {string} [panel] - Identificador del panel a cargar. Si se omite, utiliza el panel por defecto configurado en el login del usuario.
 *
 * @returns {Promise<void>}
 */
async function setPreferPanel(panel) {
    try {
        $('.notify__close').click()
        let targetPanel = typeof panel == 'undefined' ? storage.login.config.defaultPanel : panel;
        if (targetPanel !== 'fiscalizadores' && storage && storage.config && storage.config.otrs && storage.config.otrs.CMDB_ORIGINAL) {
            storage.config.otrs.CMDB = storage.config.otrs.CMDB_ORIGINAL;
        }
        await Salem.utils.partials.getSetPanel(targetPanel)
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
