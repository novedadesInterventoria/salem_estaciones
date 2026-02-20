$(async () => {
    Salem.utils.loading({title: 'Sincronizando', message: 'Se están actualizando los datos estructurales, por favor espere.'})
    await Salem.core.runtime.sync()
    window.close()
})