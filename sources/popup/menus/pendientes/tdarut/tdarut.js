$(async () => {
  await Salem.utils.loading({
    title: "Consultando en OTOBO",
    message: "Se está obteniendo los tickets rutinarios con +1 horas.",
  });
  let res = await Salem.otrs.ajax(
    storage.config.utils.updateRutinariosTDA.query
  );
  res = res.map((u) => {
    let registro = {};
    storage.config.utils.updateRutinariosTDA.headers.forEach((key) => {
      registro[key] = key == 'Servicio' ? u[key].split('::').pop() : u[key];
    });
    return registro;
  });
  await Salem.utils.loading({
    title: "Enviando datos",
    message: "Se está actualizando el libro de seguimiento.",
  });
  let response = await Salem.core.api({action: 'pendientes', subaction: 'tdarut', data: res})
  if(response && response.url) window.open(response.url, '_blank')
  window.close()
});
