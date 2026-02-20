$(async () => {
    Salem.utils.loading({message: 'Por favor espere mientras Salem se prepara.', title: 'Cargando'})
    let storage = await Salem.core.mem.get()
    if(!storage){
        Salem.utils.router(Salem.rules.routes.login)
    }
    else{
        !storage.login ? Salem.utils.router(Salem.rules.routes.login + window.location.search) : Salem.utils.router(Salem.rules.routes.sidebar + window.location.search)
    }
})