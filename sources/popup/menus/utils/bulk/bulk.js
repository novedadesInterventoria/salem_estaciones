$(() => {
    $('#bulk [name="listado"]').on('paste', e => {
        e.stopPropagation();
        e.preventDefault();
        let clipboardData = e.originalEvent.clipboardData.getData('Text');
        let lines = clipboardData.replaceAll('\r', '').split('\n')
        lines.forEach(content => {
            if(content.trim().startsWith('2')) Salem.core.runtime.zoomTicket(content)
        })
    })
})