$(() => {
    let body = storage.config.about.map(u => {
        return `<ul><code class="fw-semibold">${u.version}</code>
            ${u.cambios.map(c => `<li>${c
            .replaceAll('Corregido:', '<code class="text-success">Corregido:</code>')
            .replaceAll('Añadido:', '<code class="text-warning">Añadido:</code>')
            .replaceAll('Eliminado:', '<code class="text-danger">Eliminado:</code>')
            .replaceAll('Modificado:', '<code class="text-info">Modificado:</code>')
            }</li>`).join('')}
        </ul>`
    }).join('')
    $('[data-tag="changelog"]').html(body)
})