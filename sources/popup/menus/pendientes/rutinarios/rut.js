$(() => {
  let config = storage.config.planes.active.rutinario;
  $('[name="sheet"]').html(
    Object.keys(config).map(key => {
      return `<option value='${JSON.stringify(config[key])}'>${config[key].nombre}</option>`;
    })
  );
  $('[name="sheet"]').val("");
  $('[name="sheet"]').change(e => {
    let value = JSON.parse(e.currentTarget.value);
    $('input[name="plan"]').val(`PLAN MTTO RUTINARIO ${value.anio}`);
    $('input[name="quincena"]').val(value.nombre);
  });

  $("#downloadRut").submit(async e => {
    e.preventDefault();
    let data = Salem.utils.getFormValues(e);
    await Salem.utils.loading({ title: "Consultando", message: "Se está obteniendo la información de Salem. Por favor espere ..." });
    let response = await Salem.core.api({
      action: "pendientes",
      subaction: "rutinarios",
      plan: data.plan,
      sheet: data.quincena,
      config: storage.config.planes,
    });
    let content = new Uint8Array(response.bytes);
    let blob = new Blob([content], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    let url = URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = url;
    a.download = `Pendientes ${data.plan} ${data.quincena} ${moment().format("DD-MM-YYYY HH_mm")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);

    await Salem.utils.loading({ title: "Obteniendo gráficas", message: "Se está obteniendo los gráficos del reporte. Por favor espere ..." });
    let pdf = await Salem.core.api({ action: "pendientes", subaction: "rutinarios", pdf: true });
    content = new Uint8Array(pdf.bytes);
    blob = new Blob([content], { type: "application/pdf" });
    url = URL.createObjectURL(blob);
    a = document.createElement("a");
    a.href = url;
    a.download = `Avances ${data.plan} ${data.quincena} ${moment().format("DD-MM-YYYY HH_mm")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);

    await Salem.utils.loading();
  });
});
