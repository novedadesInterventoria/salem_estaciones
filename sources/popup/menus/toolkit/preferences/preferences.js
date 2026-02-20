$(() => {
  // Listar paneles
  let panels = [];
  $(".sidebar [data-sidebar-panel").each((i, el) => {
    panels.push({
      panel: $(el).data("sidebarPanel"),
      name: `${$(el).data("parent")} >> ${$(el).text()}`,
    });
  });

  new TomSelect($('form#preferences [name="defaultPanel"'), {
    valueField: "panel",
    searchField: "name",
    labelField: "name",
    options: panels,
    maxItems: 1,
    openOnFocus: true,
    selectOnTab: true,
    items:
      storage.login.config && storage.login.config.defaultPanel
        ? storage.login.config.defaultPanel
        : "",
  });

  // Completar con acciones previas
  $("form#preferences")
    .find("[name]")
    .each((i, el) => {
      let pref = $(el).prop("name");
      $("form#preferences")
        .find(`[name="${pref}"]`)
        .val(storage.login.config ? storage.login.config[pref] : "");
    });

  if (storage.isOffDevices)
    $("form#preferences")
      .find('[name="offDevices"]')
      .prop("checked", storage.isOffDevices);

  $("form#preferences #setPosition").click(() => {
    $("form#preferences").find('[name="positionX"]').val(window.screenX);
    $("form#preferences").find('[name="positionY"]').val(window.screenY);
  });

  $('form#preferences [name="offDevices"]').on("change", async (e) => {
    let val = $(e.currentTarget).prop("checked");
    storage.isOffDevices = val;
    await Salem.core.mem.set(storage);
    await Salem.utils.loading({
      title: "Salem config",
      message:
        "Por favor espere mientras Salem cambia el entorno de generación de tickets.",
    });
    await Salem.core.runtime.sync({ offDevices: val, noClose: true });
    await Salem.utils.loading();
  });

  $("form#preferences").submit(async (e) => {
    e.preventDefault();
    let data = Salem.utils.getFormValues(e);
    if (data.defaultPanel != "sync") {
      Salem.utils.loading({
        title: "Estableciendo configuraciones",
        message:
          "Por favor espere mientras Salem establece la nueva configuración",
      });
      await Salem.core.api({
        action: "utils",
        subaction: "userPreferences",
        toDo: "set",
        pref: data,
        firma: storage.login.firma,
      });
      storage.login.config = data;
      await Salem.core.mem.set(storage);
      window.close();
    } else {
      Salem.utils.toast({
        title: "Solicitud rechazada",
        message:
          "El panel de sincronización no puede ser el panel por defecto, pues dejaría el app en un bucle que no le permitirá su uso. Elija otro.",
        type: "error",
        noHide: true,
      });
    }
  });
});
