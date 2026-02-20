$(async () => {
    Salem.utils.loading({
        title: 'Sincronizando',
        message: 'Se están actualizando los datos estructurales y la lista de técnicos de OTOBO, por favor espere.'
    });

    try {
        await Promise.allSettled([
            Salem.core.runtime.sync(),
            (window.SalemTecnicos && typeof window.SalemTecnicos.syncFromOTRS === 'function'
                ? window.SalemTecnicos.syncFromOTRS()
                : Promise.resolve())
        ]);
    } catch (err) {
        console.warn('[SALEM][SYNC] Error durante la sincronización:', err);
    }

    Salem.utils.loading();
    window.close();
});
