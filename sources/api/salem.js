var Salem = {
  otrs: {
    utils: {
      /**
       * Vincula dos tickets de acuerdo a la configuración.
       *
       */
      link: (ticketToLink, info, tipo) => {
        return new Promise(async (resolve) => {
          Salem.utils.loading({
            title: "Consultando ticket padre",
            message: "Se está obteniendo la información del ticket padre",
          });
          let infoLink = await Salem.otrs.ajax({
            Action: "AgentTicketZoom",
            TicketNumber: ticketToLink,
            transform: "info",
          });
          let modos = {
            padre: "ParentChild::Source",
            hijo: "ParentChild::Target",
            normal: "Normal::Source",
          };
          let config = {
            Action: "AgentLinkObject",
            Mode: "Normal",
            SourceObject: "Ticket",
            SourceKey: info.id,
            TargetIdentifier: "Ticket",
            LinkTargetKeys: infoLink.id,
            TypeIdentifier: modos[tipo],
            SubmitLink: "Enlazar",
            transform: "plain",
          };
          Salem.utils.loading({
            title: "Generando vinculos",
            message: "Se está enlazando los tickets, por favor espere",
          });
          await Salem.otrs.ajax(config);
          resolve();
        });
      },
      /**
       * Mueve de cola un ticket de acuerdo a la configuración.
       * @param {JSON} info - Objeto con los campos del ticket, obligatorio {!id: error}
       * @param {String} where - Nombre de la cola. Si la cola se establece como 'define' Salem determina la cola de destino.
       * @param {JSON?} DynamicFields - Campos de la nota, obligatorio {!cuerpo ? error, !asunto ? error}, opcional: {!estado ? preserva : cambia }
       * @returns
       */
      move: (info, where, DynamicFields) => {
        return new Promise(async (resolve) => {
          await Salem.utils.loading({
            title: "Escalando ticket",
            message: "Se está moviendo este ticket a otro departamento.",
          });
          let storage = await Salem.core.mem.get();
          let moveForm = await Salem.otrs.ajax({
            Action: "AgentTicketMove",
            TicketID: info.id,
            transform: "form",
          });
          if (where == "define") {
            for (let rule of storage.config.queues.rules) {
              if (info[rule.campo].includes(rule.valor)) {
                where = rule.return;
                break;
              }
            }
          }
          moveForm.DestQueueID = storage.config.queues.list[where];
          moveForm.Subject =
            DynamicFields && DynamicFields.asunto
              ? DynamicFields.asunto
              : "REALIZAR ESCALAMIENTO";
          moveForm.Body =
            DynamicFields && DynamicFields.cuerpo
              ? DynamicFields.cuerpo
              : "Se escala para su análisis y verificación.";
          moveForm.NewStateID =
            DynamicFields && DynamicFields.estado ? DynamicFields.estado : "";
          moveForm.transform = "plain";
          await Salem.otrs.ajax(moveForm);
          resolve(true);
        });
      },
      predef: {
        /**
         * Completa campos del form de acuerdo a lo que se envíe.
         * Es obligatorio entregar {firma, cuerpo, asunto, original: {opcional}}
         *
         * Si viene el objeto 'original' entonces se sobreescriben los datos ya existentes al final y se agregan los otros.
         *
         * Ejemplo: Si se envía Object.Body y Object.original.Body, se preservará Object.original.Body
         *
         * Opcionales en DynamicFields: {!motivo ? preserva, !estado ? sin cambios,
         * !intervencion ? preserva : requiere motivo, !transform ? 'plain' : transform}
         *
         * @param {JSON} form - Objeto JSON que contiene los campos del formulario de Nota
         * @param {JSON} DynamicFields - Objeto JSON que contiene los campos a completar, opcional campo Object.original
         * @returns
         */
        notes: (form, DynamicFields) => {
          // Obligatorio
          form.DynamicField_SEGUIMIENTO = DynamicFields.firma;
          form.DynamicField_QUIENGESTIONA = DynamicFields.tcampo
            ? DynamicFields.tcampo
            : DynamicFields.firma;
          form.DynamicField_INTERVENCION = DynamicFields.intervencion
            ? DynamicFields.intervencion
            : "SI";
          form.Body = DynamicFields.cuerpo;
          form.Subject = DynamicFields.asunto;

          // Opcionales
          DynamicFields.motivo
            ? (form.DynamicField_MOTIVONOINTERVENCION = DynamicFields.motivo)
            : null;
          DynamicFields.estado
            ? (form.NewStateID = DynamicFields.estado)
            : null;

          // Si no se encuentra se obliga
          DynamicFields.intervencion
            ? (form.DynamicField_INTERVENCION = DynamicFields.intervencion)
            : "SI";
          form.transform = DynamicFields.transform
            ? DynamicFields.transform
            : "plain";
          form.IsVisibleForCustomer = !DynamicFields.visible ? undefined : "on";
          // Sobreescribir si hay campos con nombres originales ya completados
          if (DynamicFields.original)
            form = { ...form, ...DynamicFields.original };
          return form;
        },
        create: {
          /**
           *
           * @param {JSON} form - Formulario de creación de ticket de Estaciones.
           * @param {JSON} createFields - Campos para crear el ticket.
           *
           * Obligatorios: {...cmdb, asunto, cuerpo} => {name, equipo, estacion, ubicacion}
           *
           * Opcionales: {padre}
           *
           * @param {JSON} createParams - Parametros de CONS1
           * @returns
           */
          estaciones: (form, createFields, createParams) => {
            form.LinkTicketID = createFields.padre ? createFields.padre : "";
            form.TicketID = createFields.padre ? createFields.padre : "";
            form.SelectedCustomerUser = "festacion";
            form.CustomerSelected = "1";
            form.CustomerKey_1 = "festacion";
            form.CustomerTicketText_1 =
              '"FUNCIONARIO ESTACION RECAUDO BOGOTA" <control@rbsas.co>';
            form.CustomerTicketCounterFromCustomer = "1";
            form.CustomerID = "RB CLIENTE INTERNO";
            form.Dest = "22||RB::MESA DE SERVICIOS";
            form.DynamicField_ESTACION = createFields.estacion;
            form.DynamicField_EQUIPOESTACION = createFields.equipo;
            form.DropIDEquipo = createFields.name;
            form.DynamicField_IDEQUIPO = createFields.name;
            form.DynamicField_UBICACIONESTACION = createFields.ubicacion;
            form.DynamicField_REQUERIMIENTOSOPORTE = createParams.requerimiento;
            form.TypeID = createParams.type_id;
            form.ServiceID = createParams.service_id;
            form.SLAID = createParams.sla_id;
            form.Subject = createFields.asunto;
            form.Body = createFields.cuerpo.replaceAll("\n", "<br/>");
            form.PriorityID = createParams.priority_id;
            form.DynamicField_CATEGORIATICKET = "EQUIPO ESTACIONES";
            form.Cargado = "1";
            form.transform = "info";
            if (createFields.original)
              form = { ...form, ...createFields.original };
            return form;
          },
          /**
           *
           * @param {JSON} form - Formulario de creación de ticket de Buses.
           * @param {JSON} createFields - Campos para crear el ticket.
           *
           * Obligatorios: {Patio, 'ID Móvil', Placa, 'Tipo de Flota', asunto, cuerpo}
           *
           * Opcionales: {!customer: rbsas, !customerText: '"CLIENTE INTERNO  RECAUDO BOGOTA" <reportes@rbsas.co>',
           * !padreId: '', !customerName: 'RB CLIENTE INTERNO', !zonaSirci: 'NO'  }
           *
           * @param {JSON} createParams - Parametros de CONS1
           * @returns
           */
          flota: (form, createFields, createParams, storage) => {
            // Opcionales
            // Establecer el cliente.
            form.SelectedCustomerUser = createFields.customerUSer
              ? createFields.customerUSer
              : "rbsas";
            form.CustomerKey_1 = createFields.customerUSer
              ? createFields.customerUSer
              : "rbsas";
            form.CustomerTicketText_1 = createFields.customerText
              ? createFields.customerText
              : '"CLIENTE INTERNO  RECAUDO BOGOTA" <reportes@rbsas.co>';
            form.CustomerID = createFields.customerName
              ? createFields.customerName
              : "RB CLIENTE INTERNO";

            // Enlazar ticket nuevo con un ticket padre.
            form.LinkTicketID = createFields.padreId
              ? createFields.padreId
              : "";

            form.DynamicField_UBICACIONZONASIRCI = createFields.zonaSirci
              ? createFields.zonaSirci
              : "NO";

            // Campos obligatorios
            // Determinar el patio REAL buscando la SIGLA dentro del campo Patio del objeto Info
            // Tomar el primer resultado [[sigla][nombre]]
            let match = storage.config.patios.filter(
              (u) => createFields.Patio.indexOf(u[0]) != -1
            );
            form.DynamicField_PATIO = match[0][1];
            form.DynamicField_IDMOVIL = createFields["ID Móvil"];
            form.DynamicField_PLACA = createFields.Placa;
            form.DynamicField_TIPOFLOTA = createFields["Tipo de Flota"];
            form.Subject = createFields.asunto;
            form.Body = createFields.cuerpo;

            // Campos determinados por el CONS1
            form.DynamicField_EQUIPOBUS = createParams.equipo;
            form.DynamicField_REQUERIMIENTOSOPORTE = createParams.requerimiento;
            form.TypeID = createParams.type_id;
            form.ServiceID = createParams.service_id;
            form.SLAID = createParams.sla_id;
            form.PriorityID = createParams.priority_id;

            // No requeridos, se establecen por defecto.
            form.CustomerSelected = "1";
            form.CustomerTicketCounterFromCustomer = "1";
            form.Dest = "22||RB::MESA DE SERVICIOS";
            form.DynamicField_ESTADOVINCULACION = "VINCULADO";
            form.NextStateID = "34";
            form.DynamicField_CATEGORIATICKET = "EQUIPO EMBARCADO EN FLOTA";
            form.Cargado = "1";
            form.transform = "info";

            if (createFields.original)
              form = { ...form, ...createFields.original };
            return form;
          },
        },
        close: {
          /**
           * Completa campos del form de acuerdo a lo que se envíe.
           * Es obligatorio entregar {firma, cuerpo, asunto, parte, original: {opcional}}
           *
           * Si viene el objeto 'original' entonces se sobreescriben los datos ya existentes al final y se agregan los otros.
           *
           * Ejemplo: Si se envía Object.Body y Object.original.Body, se preservará Object.original.Body
           *
           * Opcionales: {!ip: NA, !order: NA, !atencion: REMOTO, !isInternal: on, !transform: plain}
           *
           * Opcionales en original (Cambios de parte): {ExistsDynamicField_PARTESBUSES#, DynamicField_SERIALINSTALADO#, DynamicField_SERIALRETIRADO#, DynamicField_PARTESBUSES#}
           *
           * @param {JSON} form - Objeto JSON que contiene los campos del formulario de Nota
           * @param {JSON} DynamicFields - Objeto JSON que contiene los campos a completar, opcional campo Object.original
           * @param {JSON} closeParams - Objeto JSON que contiene los parámetros de cierre del ticket
           * @returns
           */
          flota: (form, DynamicFields, closeParams) => {
            // Obligatorios, si no vienen no funcionará
            form.Body = DynamicFields.cuerpo;
            form.Subject = DynamicFields.asunto;
            form.DynamicField_QUIENGESTIONABUSES = DynamicFields.tcampo
              ? DynamicFields.tcampo
              : DynamicFields.firma;
            form.NewStateID = DynamicFields.state ? DynamicFields.state : "33"; // Resuelto
            form.DynamicField_CAMBIOPARTE = DynamicFields.parte
              ? DynamicFields.parte
              : "NO";

            form.DynamicField_TIPOFALLA = closeParams.falla;
            form.DynamicField_TSF = closeParams.minutes;
            form.SLAID = closeParams.sla_id;
            form.ServiceID = closeParams.service_id;
            form.TypeID = closeParams.type_id;

            // Opcionales, si no se encuentra se asigna por defecto
            form.DynamicField_IP = DynamicFields.ip ? DynamicFields.ip : "NA";
            form.DynamicField_ORDENDETRABAJO = DynamicFields.orden
              ? DynamicFields.orden
              : "NA";
            form.DynamicField_TIPOATENCION = DynamicFields.atencion
              ? DynamicFields.atencion
              : "REMOTO";

            DynamicFields.isInternal
              ? (form.IsVisibleForCustomer = "on")
              : null;
            form.transform = DynamicFields.transform
              ? DynamicFields.transform
              : "plain";
            form.Cargado = "1";
            form.Bloques = DynamicFields.bloques ? DynamicFields.bloques : "1";
            if (DynamicFields.original)
              form = { ...form, ...DynamicFields.original };
            return form;
          },
          /**
           * Completa campos del form de acuerdo a lo que se envíe.
           * Es obligatorio entregar {firma, cuerpo, asunto, parte, original: {opcional}}
           *
           * Si viene el objeto 'original' entonces se sobreescriben los datos ya existentes al final y se agregan los otros.
           *
           * Ejemplo: Si se envía Object.Body y Object.original.Body, se preservará Object.original.Body
           *
           * Opcionales: {!atencion: REMOTO, !isInternal: on, !transform: plain}
           *
           * Opcionales en original (Cambios de parte): {ExistsDynamicField_PARTES#, DynamicField_SERIALINSTALADO#, DynamicField_SERIALRETIRADO#, DynamicField_PARTESBUSES#}
           *
           * @param {JSON} form - Objeto JSON que contiene los campos del formulario de Nota
           * @param {JSON} DynamicFields - Objeto JSON que contiene los campos a completar, opcional campo Object.original
           * @param {JSON} closeParams - Objeto JSON que contiene los parámetros de cierre del ticket
           * @returns
           */
          estaciones: (form, DynamicFields, closeParams) => {
            // Obligatorios, si no vienen no funcionará
            form.Body = DynamicFields.cuerpo;
            form.Subject = DynamicFields.asunto;
            form.DynamicField_QUIENGESTIONA = DynamicFields.tcampo
              ? DynamicFields.tcampo
              : DynamicFields.firma;
            form.DynamicField_MALAMANIPULACION = DynamicFields.isMmov
              ? DynamicFields.isMmov
              : "NO";
            form.NewStateID = DynamicFields.state ? DynamicFields.state : "33"; // Resuelto
            form.DynamicField_CAMBIOPARTE = DynamicFields.parte
              ? DynamicFields.parte
              : "NO";

            form.DynamicField_TIPOFALLA = closeParams.falla;
            form.DynamicField_TSF = closeParams.minutes;
            form.SLAID = closeParams.sla_id;
            form.ServiceID = closeParams.service_id;
            form.TypeID = closeParams.type_id;

            // Opcionales, si no se encuentra se asigna por defecto
            form.DynamicField_TIPOATENCION = DynamicFields.atencion
              ? DynamicFields.atencion
              : "REMOTO";

            !DynamicFields.isInternal
              ? (form.IsVisibleForCustomer = "on")
              : null;
            form.transform = DynamicFields.transform
              ? DynamicFields.transform
              : "plain";
            form.Cargado = "1";
            form.Bloques = DynamicFields.bloques ? DynamicFields.bloques : "1";
            if (DynamicFields.original)
              form = { ...form, ...DynamicFields.original };
            return form;
          },
        },
      },
    },
    /**
     * Verifica una serie de condiciones para determinar si una evaluación dada es verdadera o falsa.
     * @param {Array} config - Reglas a verificar {isAlive, isZoom, isOTRS, isBuses, isSameState, isState}
     * @param {Array?} forceInfo - Obliga a verificar sobre el objeto que se pase en este parámetro,
     * ideal cuando se require verificar la generación de un ticket nuevo
     * @returns
     */
    middleware: (config, forceInfo) => {
      return new Promise(async (resolve) => {
        await Salem.utils.loading({
          title: "Middleware",
          message:
            "Realizando operaciones de verificación para el control de flujo.",
        });
        let flag = true,
          index = 0,
          alert = {};
        let info =
          typeof forceInfo == "undefined"
            ? await Salem.core.runtime.getInfo({ dom: config.dom })
            : forceInfo;
        for (let i of Object.keys(config)) {
          switch (i) {
            case "isAlive":
              let aliveDom = await Salem.otrs.ajax({
                Action: "AgentDashboard",
                type: "GET",
                transform: "dom",
              });
              let aliveLogin = await Salem.core.runtime.getInfo({
                dom: aliveDom,
              });
              if (typeof aliveLogin.isLogin != "undefined") {
                alert.title = "Se requiere sesión de OTOBO";
                alert.message =
                  "La sesión de OTOBO no existe o está vencida, restablezca su sesión y refresque la ventana principal para continuar.";
                flag = false;
              }
              break;
            case "isZoom":
              if (info.isZoom == false) {
                alert.title = "Se requiere vista AgentTicketZoom";
                alert.message =
                  "Esta utilidad requiere vista de AgentTicketZoom, asegúrese de tener vista directa con la información del ticket.";
                flag = false;
              }
              break;
            case "isOTRS":
              if (typeof info == "undefined") {
                alert.title = "Vista de OTOBO requerida";
                alert.message =
                  "No ha sido posible establecer una conexión directa con OTOBO. Sitúese sobre una pestaña de OTOBO y abra de nuevo esta ventana.";
                flag = false;
              }
              break;
            case "isCat":
              if (
                info["Categoría del Ticket"] != config[i] &&
                config[i].indexOf(info["Categoría del Ticket"]) == -1
              ) {
                alert.title = "Categoría incompatible";
                alert.message = `Este ticket es de ${info["Categoría del Ticket"]} pero debe ser ${config[i]}.`;
                flag = false;
              }
              break;
            case "isSameState":
              let res = await Salem.otrs.events.sync(info);
              if (res.length == 0) {
                alert.title = "Consulta vacía";
                alert.message = `Este ticket no fue encontrado al realizar una consulta rápida.`;
                flag = false;
              } else {
                if (res[0].Estado != info.Estado) {
                  alert.title = "Ticket cambió de estado";
                  alert.message = `Este ticket cambió de <b>${info.Estado}</b> a <b>${res[0].Estado}</b>. 
                                        Para evitar saltos de estado, el middleware de Salem ha rechazado su solicitud.`;
                  flag = false;
                }
              }
              break;
            case "isState":
              let sync = await Salem.otrs.events.sync(info);
              if (sync.length == 0) {
                alert.title = "Consulta vacía";
                alert.message = `Este ticket no fue encontrado al realizar una consulta rápida.`;
                flag = false;
              } else {
                if (
                  Array.isArray(config[i])
                    ? config[i].indexOf(sync[0].Estado) == -1
                    : sync[0].Estado != config[i]
                ) {
                  alert.title = "Estado es distinto al esperado";
                  alert.message = `Se esperaba que el ticket estuviese en el estado <b>${config[i]}</b> pero está en <b>${sync[0].Estado}</b>. 
                                        Salem no podrá realizar operaciones posteriores que dependan de esta.`;
                  flag = false;
                }
              }
              break;
          }
          if (flag == false) break;
          index++;
        }
        if (typeof config.silent == "undefined" && flag == false) {
          window.location.href.includes("/otobo/")
            ? Salem.utils.toast({ ...alert, noHide: true, type: "error" })
            : Salem.utils.modalError(alert);
        }
        await Salem.utils.loading();
        resolve(flag);
      });
    },
    ajax: (payload, token) => {
      return new Promise(async (resolve) => {
        info =
          typeof token != "undefined"
            ? { token }
            : await Salem.core.runtime.getInfo();

        if (!info || !info.token) {
          console.warn("Salem :: No se pudo obtener el ChallengeToken. Verifique que la pestaña de OTOBO esté activa y cargada.");
          resolve(null);
          return;
        }

        payload.ChallengeToken = info.token;
        let params = $.param(payload, true);
        $.ajax({
          url: Salem.rules.routes.otrs,
          type: payload.type ? payload.type : "POST",
          data: params,
          success: (res) => {
            let result = payload.transform
              ? Salem.utils.parse[payload.transform](res)
              : res;
            resolve(result);
          },
        });
      });
    },
    attach: (files, form, name) => {
      return new Promise((resolve, reject) => {
        Salem.utils.loading({
          title: "Subiendo archivo(s)",
          message: "Por favor espere mientras Salem completa el envío.",
        });
        $.each(files, (index, File) => {
          let Upload = new FormData();
          Upload.append(
            "Files",
            File,
            Array.isArray(name) ? name[index].name : name
          );
          Upload.append("Action", "AjaxAttachment");
          Upload.append("Subaction", "Upload");
          Upload.append("FormID", form.FormID);
          Upload.append("ChallengeToken", form.ChallengeToken);
          $.ajax({
            type: "POST",
            url: Salem.rules.routes.otrs,
            data: Upload,
            dataType: "json",
            cache: false,
            contentType: false,
            processData: false,
            success: function (r) {
              resolve(r);
              Salem.utils.loading();
            },
            error: function (r) {
              reject(r);
            },
          });
        });
      });
    },
    events: {
      sync: (info) => {
        return new Promise(async (resolve) => {
          let res = await Salem.otrs.ajax({
            ShownAttributes: "LabelTicketNumber",
            TicketNumber: info.ticket,
            Action: "AgentTicketSearch",
            Subaction: "Search",
            ResultForm: "CSV",
            transform: "csv",
          });
          resolve(res);
        });
      },
      /**
       * Envía una evidencia del tipo imagen a OTOBO
       * @param {Event} e - Evento jQuery del tipo 'paste'
       * @param {JSON} form - Elemento JSON que representa el formulario sobre el cual se hace match.
       * @param {JSON} info - Elemento JSON que representa el los datos del ticket.
       * @returns
       */
      onPaste: (event, form, info) => {
        return new Promise(async (resolve) => {
          let evImg = event.originalEvent;
          let item = Array.from(evImg.clipboardData.items).find((x) =>
            /^image\//.test(x.type)
          );
          if (item) {
            if (form && form.ChallengeToken) {
              let blob = item.getAsFile();
              let base = URL.createObjectURL(blob);
              let img = new Image();
              img.src = base;
              let filename = `Evidencia_${info.ticket}_${new Date().getTime(
                "/"
              )}.png`;
              await Salem.otrs.attach([blob], form, filename);
              form.AttachmentExists = 1;
              await Salem.utils.imageUploaded({
                filename: filename,
                src: base,
              });
              resolve({ form: form, valid: true });
            } else {
              Salem.utils.toast({
                title: "No hay formulario activo",
                message:
                  "Debe escoger un tipo de gestión en el menú desplegable antes de intentar adjuntar evidencias.",
                type: "error",
                noHide: true,
              });
            }
          } else {
            resolve({ form: form, valid: false });
          }
        });
      },
      /**
       * Envía archivos adjuntos a OTOBO
       * @param {Event} e - Evento jQuery del tipo 'change' o Array de Files
       * @param {JSON} form - Elemento JSON que representa el formulario sobre el cual se hace match.
       * @returns
       */
      onDragFiles: (event, form, isArrayFiles) => {
        return new Promise(async (resolve) => {
          if (form && form.ChallengeToken) {
            let blob = isArrayFiles ? event : event.target.files;
            let names = Array.from(blob).map((u) => {
              return { name: u.name };
            });
            await Salem.otrs.attach(blob, form, names);
            form.AttachmentExists = 1;
            resolve({ form: form, valid: true });
          } else {
            Salem.utils.toast({
              title: "No hay formulario activo",
              message:
                "Debe escoger un tipo de gestión en el menú desplegable antes de intentar adjuntar evidencias.",
              type: "error",
              noHide: true,
            });
            resolve({ form: form, valid: false });
          }
        });
      },
    },
  },
  core: {
    emit: (message) => {
      return new Promise((resolve) => {
        let searchParams = window.location.search;
        let query = new URLSearchParams(searchParams);
        let tabId = parseInt(query.get("tabId"));
        chrome.tabs.sendMessage(tabId, message, (res) => {
          let lastError = chrome.runtime.lastError;
          if (lastError) {
            console.log(lastError.message);
            resolve(res);
            return;
          }
          resolve(res);
        });
      });
    },
    listen: async () => {
      console.log("Salem runtime listening is up.");
      let storage = await Salem.core.mem.get();
      let ahora = Date.now();

      if (!storage || !storage.login || ahora >= storage.login.expiresAt) {
        if (window.location.href.includes("sources/popup/login/login.html"))
          return;
        Salem.utils.router(
          Salem.utils.getFullPath(Salem.rules.routes.login + "?back=true")
        );
        return;
      }
      if (Salem.utils.checker.isOTRS()) {
        // Check autosync
        Salem.core.checkSync(storage);

        // Agregar escuchador de mensajes
        chrome.runtime.onMessage.addListener((req, sender, res) => {
          Salem.core.runtime[req.action](req).then((result) => res(result));
          return true;
        });

        let info = await Salem.core.runtime.getInfo();
        if (info && info.isZoom) {
          Salem.core.runtime.mra(storage, info);
        }
      }

      // Agregar escuchadores y utilidades
      $(document).on("click", ".is-otrs", (e) =>
        Salem.core.runtime.zoomTicket($(e.currentTarget).text())
      );





    },
    checkSync: async (storage) => {
      let ahora = Date.now();
      if (storage && storage.syncDate && ahora >= storage.syncDate)
        Salem.core.runtime.sync();
    },

    runtime: {
      mra: async (storage, info) => {
        storage =
          storage && storage.config ? storage : await Salem.core.mem.get();
        info = info && info.isZoom ? info : await Salem.core.runtime.getInfo();
        let package = [];
        for (let key of Object.keys(storage.config.mra)) {
          let regla = storage.config.mra[key];
          counter = 0;
          regla.verificaciones.forEach((criterio) => {
            if (info[criterio.campo]) {
              let flag = false;
              criterio.ref
                ? (criterio.valor = Salem.utils.getValueByRef(
                  criterio.ref,
                  storage
                ))
                : null;
              switch (criterio.modo) {
                case "indexof":
                  flag =
                    criterio.valor.indexOf(info[criterio.campo]) != -1
                      ? true
                      : false;
                  break;
                case "no_indexof":
                  flag =
                    criterio.valor.indexOf(info[criterio.campo]) == -1
                      ? true
                      : false;
                  break;
                case "includes":
                  flag = info[criterio.campo].includes(criterio.valor)
                    ? true
                    : false;
                  break;
                case "no_includes":
                  flag = !info[criterio.campo].includes(criterio.valor)
                    ? true
                    : false;
                  break;
                case "typeof":
                  flag =
                    typeof info[criterio.campo] == criterio.valor
                      ? true
                      : false;
                  break;
              }
              if (flag) counter++;
            }
          });
          if (counter == regla.verificaciones.length) {
            regla.ajax ? package.push(regla.ajax) : null;
            regla.show ? await Salem.utils.toast(regla.show) : null; // Esperar por acción si es swal.
          }
        }
        if (package.length != 0) {
          // Llamada a API sin espera
          Salem.core.api({
            action: "runtime",
            subaction: "mra",
            package,
            otrs: info,
            config: storage.config.planes,
          });
        }
      },
      zoomTicket: (TicketNumber) => {
        window.open(
          Salem.rules.routes.otrs +
          "?Action=AgentTicketZoom;TicketNumber=" +
          TicketNumber,
          "_blank"
        );
      },
      /**
       * Realiza la traza de estados a un ticket de acuerdo al flujo establecido.
       * @param {JSON} info - Objeto JSON con los campos del ticket, obligatorio {!id: Error}
       * @param {JSON} params - Parámetros de la traza, obligatorio: {firma, inicio, destino, !tcampo : firma, !hora: now}
       * @returns
       */

      ////Traza creaciòn de tickets/////

      sweepCreate: (info, params) => {
        return new Promise(async (resolve) => {
          await Salem.utils.loading({
            title: "Enviando nota",
            message: "Se está realizando el envío de notas",
          });
          // Calcular la traza de estados
          let storage = await Salem.core.mem.get();
          let cat = info["Categoría del Ticket"].toLowerCase().includes("flota")
            ? "buses"
            : "no_buses";
          let jumps = storage.config.sweep[cat].arbol_estados[info.Estado];
          let form = await Salem.otrs.ajax({
            type: "GET",
            transform: "form",
            Action: "AgentTicketPriority",
            TicketID: info.id,
          });

          // Controlar el tcampo si el servicio es DCA, se reciben 2 dígitos y se debe concatenar 'AUXILIARDCA'
          // Si hay tcampo y es de dos dígitos y el servicio incluye DCA
          if (
            params.tcampo &&
            params.tcampo.length <= 2 &&
            info.Servicio.includes("DCA")
          )
            params.tcampo = `AUXILIARDCA${parseInt(params.tcampo)}`;
          if (params.hora == "") params.hora = moment().format("HH:mm");

          for (let i in jumps.cross) {
            await Salem.utils.loading({
              title: "Enviando nota",
              message: `Se está realizando el envío de nota para estado ${jumps.cross[i]}`,
            });
            let nota = storage.config.sweep[cat].notas[jumps.cross[i]];
            form.Body =
              params.nota && jumps.cross[i] == params.destino
                ? params.nota
                : params.tcampo
                  ? nota.texto.replaceAll("$tcampo", params.tcampo)
                  : "CAMBIO DE ESTADO";
            form.Subject = params.tcampo
              ? nota.asunto
                .replaceAll("$firma", storage.login.firma)
                .replaceAll("$hora", params.hora)
              : "CAMBIO DE ESTADO";
            form.NewStateID = nota.status_code;
            form.DynamicField_SEGUIMIENTO = storage.login.firma;
            form.DynamicField_ = params.tcampo;
            form.SLAID = 11;

            // Poner cambio de técnico si es que el estado actual es igual al destino.
            form.Subject =
              info.Estado == params.destino
                ? `CAMBIO DE TÉCNICO`
                : form.Subject;

            // Definir si es nota externa
            params.tcampo ? (form.IsVisibleForCustomer = "on") : null;

            // Enviar info a OTOBO
            await Salem.otrs.ajax({ transform: "form", ...form });

            // Cortar ejecución si el estado enviado corresponde al destino
            if (jumps.cross[i] == params.destino) break;
          }

          // Comprobar si la traza fue exitosa
          let result = await Salem.otrs.middleware(
            { isState: params.destino },
            info
          );
          resolve(result);


        });
      },

      ////Traza de estados Preventivos y rutinarios normales/////

      sweep: (info, params) => {
        return new Promise(async (resolve) => {
          await Salem.utils.loading({
            title: "Enviando nota",
            message: "Se está realizando el envío de notas",
          });
          //Calcular la traza de estados
          let storage = await Salem.core.mem.get();
          let cat = info["Categoría del Ticket"].toLowerCase().includes("flota")
            ? "buses"
            : "no_buses";
          let jumps = storage.config.sweep[cat].arbol_estados[info.Estado];
          let form = await Salem.otrs.ajax({
            type: "GET",
            transform: "form",
            Action: "AgentTicketNote",
            TicketID: info.id,
          });

          // Controlar el tcampo si el servicio es DCA, se reciben 2 dígitos y se debe concatenar 'AUXILIARDCA'
          // Si hay tcampo y es de dos dígitos y el servicio incluye DCA
          if (
            params.tcampo &&
            params.tcampo.length <= 2 &&
            info.Servicio.includes("DCA")
          )
            params.tcampo = `AUXILIARDCA${parseInt(params.tcampo)}`;
          if (params.hora == "") params.hora = moment().format("HH:mm");

          for (let i in jumps.cross) {
            await Salem.utils.loading({
              title: "Enviando nota",
              message: `Se está realizando el envío de nota para estado ${jumps.cross[i]}`,
            });
            let nota = storage.config.sweep[cat].notas[jumps.cross[i]];
            form.Body =
              params.nota && jumps.cross[i] == params.destino
                ? params.nota
                : params.tcampo
                  ? nota.texto.replaceAll("$tcampo", params.tcampo)
                  : "CAMBIO DE ESTADO";
            form.Subject = params.tcampo
              ? nota.asunto
                .replaceAll("$firma", storage.login.firma)
                .replaceAll("$hora", params.hora)
              : "CAMBIO DE ESTADO";
            form.NewStateID = nota.status_code;
            form.DynamicField_QUIENGESTIONA = params.tcampo
              ? params.tcampo
              : storage.login.firma;
            form.DynamicField_SEGUIMIENTO = storage.login.firma;
            form.DynamicField_INTERVENCION = "SI";

            // Poner cambio de técnico si es que el estado actual es igual al destino.
            form.Subject =
              info.Estado == params.destino
                ? `CAMBIO DE TÉCNICO`
                : form.Subject;

            // Definir si es nota externa
            params.tcampo ? (form.IsVisibleForCustomer = "on") : null;

            // Enviar info a OTOBO

            await Salem.otrs.ajax({ transform: "form", ...form });

            // Cortar ejecución si el estado enviado corresponde al destino
            if (jumps.cross[i] == params.destino) break;
          }

          //Comprobar si la traza fue exitosa
          let result = await Salem.otrs.middleware(
            { isState: params.destino },
            info
          );
          resolve(result);
          //params.redirect ? Salem.emit({ action: otrs.redirect }) : null
        });
      },
      sweepMttoEspeciales: (info, params) => {
        return new Promise(async (resolve) => {
          await Salem.utils.loading({
            title: "Enviando nota",
            message: "Se está realizando el envío de notas",
          });
          //Calcular la traza de estados
          let storage = await Salem.core.mem.get();
          let cat = info["Categoría del Ticket"].toLowerCase().includes("flota")
            ? "buses"
            : "no_buses";
          let jumps = storage.config.sweep[cat].arbol_estados["ESPECIAL_MTTO"];
          let form = await Salem.otrs.ajax({
            type: "GET",
            transform: "form",
            Action: "AgentTicketNote",
            TicketID: info.id,
          });

          // Controlar el tcampo si el servicio es DCA, se reciben 2 dígitos y se debe concatenar 'AUXILIARDCA'
          // Si hay tcampo y es de dos dígitos y el servicio incluye DCA
          if (
            params.tcampo &&
            params.tcampo.length <= 2 &&
            info.Servicio.includes("DCA")
          )
            params.tcampo = `AUXILIARDCA${parseInt(params.tcampo)}`;
          if (params.hora == "") params.hora = moment().format("HH:mm");

          for (let i in jumps.cross) {
            await Salem.utils.loading({
              title: "Enviando nota",
              message: `Se está realizando el envío de nota para estado ${jumps.cross[i]}`,
            });
            let nota = storage.config.sweep[cat].notas[jumps.cross[i]];
            form.Body =
              params.nota && jumps.cross[i] == params.destino
                ? params.nota
                : params.tcampo
                  ? nota.texto.replaceAll("$tcampo", params.tcampo)
                  : "CAMBIO DE ESTADO";
            form.Subject = params.tcampo
              ? nota.asunto
                .replaceAll("$firma", storage.login.firma)
                .replaceAll("$hora", params.hora)
              : "CAMBIO DE ESTADO";
            form.NewStateID = nota.status_code;
            form.DynamicField_QUIENGESTIONA = params.tcampo
              ? params.tcampo
              : storage.login.firma;
            form.DynamicField_SEGUIMIENTO = storage.login.firma;
            form.DynamicField_INTERVENCION = "SI";

            // Poner cambio de técnico si es que el estado actual es igual al destino.
            form.Subject =
              info.Estado == params.destino
                ? `CAMBIO DE TÉCNICO`
                : form.Subject;

            // Definir si es nota externa
            params.tcampo ? (form.IsVisibleForCustomer = "on") : null;

            // Enviar info a OTOBO

            await Salem.otrs.ajax({ transform: "form", ...form });

            // Cortar ejecución si el estado enviado corresponde al destino
            if (jumps.cross[i] == params.destino) break;
          }

          //Comprobar si la traza fue exitosa
          let result = await Salem.otrs.middleware(
            { isState: params.destino },
            info
          );
          resolve(result);
          //params.redirect ? Salem.emit({ action: otrs.redirect }) : null
        });
      },
      reload: () => {
        return new Promise(async (resolve) => {
          if (Salem.utils.checker.isOTRS()) {
            await Salem.utils.loading({
              title: "Refrescando vista",
              message:
                "Se están actualizando los datos de esta ventana, por favor espere.",
            });
            window.location.reload();
            resolve();
          } else {
            Salem.core.emit({ action: "reload" });
            resolve();
          }
        });
      },
      getInfo: (req) => {
        return new Promise(async (resolve, reject) => {
          try {
            let url = window.location.href;
            if (url.includes("/otobo/index.pl") || (req && typeof req.dom != "undefined")) {
              let campos = {};
              if (req && req.dom) req.dom = $(req.dom);

              // Obtener datos del formulario
              let form = req && req.dom ? req.dom.find("form").serializeArray() : $("form").serializeArray();
              if (form.length != 0) {
                let flagLogin = 0;
                form.forEach(reg => {
                  (reg.name == "User" || reg.name == "Password") ? flagLogin++ : null;
                });
                if (flagLogin == 2) campos.isLogin = true;
              }

              // Obtener campos específicos como ticket, id y token
              campos.ticket = (() => {
                let headlineText = req && req.dom
                  ? req.dom.find(".Headline").text()
                  : $(".Headline").text();
                let parts = headlineText.split("—");
                if (parts.length > 0) {
                  let ticketPart = parts[0].split("#");
                  if (ticketPart.length > 1) {
                    return ticketPart[1].trim();
                  }
                }
                return null;
              })();

              campos.id = (() => {
                let asPopupElement = req && req.dom
                  ? req.dom.find(".AsPopup[href*='TicketID=']").first()
                  : $(".AsPopup[href*='TicketID=']").first();
                let href = asPopupElement.attr("href");
                if (href) {
                  let parts = href.split("=");
                  if (parts.length > 2) {
                    return parts[2].split(";")[0];
                  }
                }
                return null;
              })();

              campos.token = req && req.dom
                ? req.dom.find('input[name="ChallengeToken"]').val()
                : $('input[name="ChallengeToken"]').val();

              let labels = req && req.dom ? req.dom.find("label") : $("label");
              let ps = req && req.dom ? req.dom.find("p") : $("p");

              // Verificar si hay etiquetas de "Servicio"
              let isService = req && req.dom
                ? req.dom.find('label:contains("Servicio")')
                : $('label:contains("Servicio")');

              // Procesar etiquetas de servicio si existen
              if (isService.length != 0) {
                labels.each(function (index, label) {
                  let labelText = $(label).text().trim().slice(0, -1); // Quitar el ':' al final del texto

                  // Lista de etiquetas a excluir
                  const excludedLabels = [
                    "Communication channel",
                    "Sender Type",
                    "Grabar configuración de filtros como defecto",
                    "Customer visibility",
                    "Creado por"
                  ];

                  // Verificar si la etiqueta actual no está en la lista de exclusiones
                  if (!excludedLabels.some(excluded => labelText.includes(excluded))) {
                    let correspondingP = $(label).next('p').text().trim(); // Obtener el párrafo correspondiente
                    campos[labelText] = correspondingP;
                  }
                });
              }
              campos.Creado
                ? (campos.Creado = moment(
                  campos.Creado.replace(" - ", " "),
                  "DD/MM/YYYY HH:mm"
                ).format("YYYY-MM-DD HH:mm"))
                : (campos.Creado = undefined);
              campos.titulo = campos.ticket
                ? req && req.dom
                  ? $(req.dom)
                    .find(".Headline")[0]
                    .childNodes[3].innerText.trim()
                  : $(".Headline")[0].childNodes[3].innerText.trim()
                : null;
              campos.rotulo = campos.titulo
                ? campos.titulo.split("—")[1].trim()
                : null;
              campos.last_prog = campos.ticket
                ? (() => {
                  let filas =
                    req && req.dom
                      ? $(req.dom).find("#ArticleTable tbody tr")
                      : $("#ArticleTable tbody tr");
                  let hora = null;
                  for (let i = filas.length - 1; i >= 0; i--) {
                    let tit = filas[i].children[5].children[0].title;
                    if (
                      tit.includes("PROGRESO") ||
                      tit.includes("CAMBIO DE T")
                    ) {
                      hora = filas[i].children[6].children[0].title.replace(
                        " - ",
                        " "
                      );
                      break;
                    }
                  }
                  return hora;
                })()
                : null;

              campos.first_prog = campos.ticket
                ? (() => {
                  let filas =
                    req && req.dom
                      ? $(req.dom).find("#ArticleTable tbody tr")
                      : $("#ArticleTable tbody tr");
                  let hora = null;
                  for (let i = 0; i < filas.length; i++) {
                    let tit = filas[i].children[5].children[0].title;
                    if (
                      tit.includes("PROGRESO") ||
                      tit.includes("CAMBIO DE T")
                    ) {
                      hora = filas[i].children[6].children[0].title.replace(
                        " - ",
                        " "
                      );
                      break;
                    }
                  }
                  return hora;
                })()
                : null;

              campos.resuelto = campos.ticket
                ? (() => {
                  let filas =
                    req && req.dom
                      ? $(req.dom).find("#ArticleTable tbody tr")
                      : $("#ArticleTable tbody tr");
                  let hora = null;
                  for (let i = 0; i < filas.length; i++) {
                    let tit = filas[i].children[5].children[0].title;
                    if (tit.toLowerCase().includes("resuelto")) {
                      hora = filas[i].children[6].children[0].title.replace(
                        " - ",
                        " "
                      );
                      break;
                    }
                  }
                  if (hora == null) {
                    if (
                      [
                        "RESUELTO",
                        "CERRADO",
                        "CERRADO POR INFORMACION",
                        "ANULADO POR DUPLICIDAD",
                      ].indexOf(campos.Estado) != -1
                    ) {
                      hora = filas[
                        filas.length - 1
                      ].children[6].children[0].title.replace(" - ", " ");
                    }
                  }
                  return hora;
                })()
                : null;

              campos.anulado = campos.ticket
                ? (() => {
                  let filas = req && req.dom ? $(req.dom).find("#ArticleTable tbody tr") : $("#ArticleTable tbody tr");
                  let campoAnulado = null;
                  for (let i = filas.length - 1; i >= 0; i--) {
                    let asunto = $(filas[i]).find("td:eq(5)").text().trim();
                    if (asunto.toLowerCase().includes("anulado")) {
                      campoAnulado = asunto;
                      break;
                    }
                  }
                  return campoAnulado;
                })()
                : null;



              campos.partes = campos.ticket
                ? (() => {
                  let filas =
                    req && req.dom
                      ? $(req.dom).find(
                        $('.Header h2:contains("Partes Cambiadas")')
                          .closest(".WidgetSimple")
                          .find("table tbody tr")
                      )
                      : $('.Header h2:contains("Partes Cambiadas")')
                        .closest(".WidgetSimple")
                        .find("table tbody tr");
                  return Array.from(filas).map((tr) => {
                    return {
                      nombre: tr.children[0].innerText,
                      instalado: tr.children[1].innerText,
                      retirado: tr.children[2].innerText,
                    };
                  });
                })()
                : [];

              // Extrar nota de creación
              campos.isZoom =
                campos.id != null && campos.rotulo != null ? true : false;

              let zoomTicket =
                req && req.dom
                  ? $(req.dom).find("#Row1 input").val()
                  : $("#Row1 input").val();
              let creacion = zoomTicket
                ? zoomTicket
                  .split(";")
                  .filter((u) => u.includes("ArticleID"))[0]
                  .split("=")
                : null;
              if (creacion && campos.token && req && req.getNote == true) {
                let htmlView = await Salem.otrs.ajax(
                  {
                    Action: "AgentTicketArticleContent",
                    Subaction: "HTMLView",
                    TicketID: campos.id,
                    ArticleID: creacion[1],
                    transform: "plain",
                  },
                  campos.token
                );
                campos.notaCreacion = $(htmlView).text();
              }

              if (req && req.getLinks) {
                let searchLinked = {
                  Action: "AgentTicketZoom",
                  Subaction: "LoadWidget",
                  TicketID: campos.id,
                  ElementID: "Async_0001-TicketLinks",
                };
                let linkedContent = await Salem.otrs.ajax(
                  { ...searchLinked, transform: "plain" },
                  campos.token
                );
                let cards = $(linkedContent).find(".DataTable");
                let existLinks = !cards
                  .text()
                  .includes("No hay tickets enlazados");
                let links = [];
                if (existLinks) {
                  let conv = {
                    0: "ticket",
                    1: "rotulo",
                    2: "Estado",
                    3: "Cola",
                    4: "Categoría del Ticket",
                    5: "Creado",
                    6: "Parentesco",
                  };
                  cards.each((index, card) => {
                    let rows = $(card).find("tr");
                    let toPush = {};
                    rows.each((i, row) => {
                      let text = $(row).find("td")[1];
                      if (text) {
                        conv[i]
                          ? (toPush[conv[i]] = $(row)
                            .find("td")[1]
                            .innerText.trim())
                          : null;
                      }
                    });
                    links.push(toPush);
                  });
                }
                campos.enlaces = links;
              }
              resolve(campos);
            } else {
              campos = await Salem.core.emit({ action: "getInfo", req: req });
              resolve(campos || {});
            }
          } catch (error) {
            reject(error);
          }
        });
      },
      sync: (config) => {
        return new Promise(async (resolve) => {
          let res = await Salem.core.api({
            action: "utils",
            subaction: "sync",
            ...config,
          });
          if (res && res.done) {
            let storage = await Salem.core.mem.get();
            if (!storage) {
              storage = { config: res.config };
            } else {
              if (!config) storage.isOffDevices = false;
              storage.config = res.config;
            }
            storage.syncDate = Date.now() + 7.2e6;
            await Salem.core.mem.set(storage);
            resolve(storage);
          } else {
            Salem.utils.modalError({
              title: "Sincronización fallida",
              message:
                "El API ha respondido con un error " + JSON.stringify(res),
            });
          }
        });
      },
    },
    mem: {
      get: () => {
        return new Promise((resolve) => {
          chrome.storage.local.get(Salem.rules.storage, (e) => {
            resolve(e[Salem.rules.storage]);
          });
        });
      },
      set: (e) => {
        return new Promise((resolve) => {
          chrome.storage.local.set({ [Salem.rules.storage]: e }, () => {
            resolve();
          });
        });
      },
      clear: () => {
        return new Promise((resolve) => {
          chrome.storage.sync.clear();
          chrome.storage.local.clear();
          resolve();
        });
      },
    },
    api: (request, forceProd) => {
      return new Promise(async (resolve) => {
        let storage = await Salem.core.mem.get();
        let urlType = forceProd
          ? "prod"
          : !storage
            ? "prod"
            : storage.dev
              ? "dev"
              : "prod";
        $.ajax({
          url: `${Salem.rules.api[urlType]}${urlType === "dev" ? `${storage.dev}` : ""
            }`,
          type: request.type ? request.type : "POST",
          data: JSON.stringify(request),
          success: (res) => {
            resolve(res);
          },
        }).fail((ex) => {
          $("body").html(ex.responseText);
        });
      });
    },
  },
  utils: {
    getFullPath: (path) => {
      return chrome.runtime.getURL(path);
    },
    checker: {
      isOTRS: () => {
        return window.location.href.includes("/otobo/");
      },
    },
    getValueByRef: (e, reference) => {
      let valueReferenced = e.split(".").reduce(function (prev, next) {
        return prev && prev[next];
      }, reference);
      return valueReferenced;
    },
    swal: {
      fire: (config, callback) => {
        return new Promise((resolve) => {
          Swal.fire({ ...config, ...Salem.utils.swal.predef(config) }).then(
            (u) => {
              if (typeof callback == "function") callback();
              resolve();
            }
          );
        });
      },
      predef: (config) => {
        return {
          icon: config && config.icon ? config.icon : undefined,
          allowOutsideClick: false,
          allowEnterKey: false,
          allowEscapeKey: false,
        };
      },
    },
    ajax: (url, type) => {
      return new Promise((resolve) => {
        $.ajax({
          url,
          type: "GET",
          success: (e) => {
            e = e.replaceAll("salemsrc/", chrome.runtime.getURL(""));
            let r = Salem.utils.parse[type](e);
            resolve(r);
          },
        }).fail(() => {
          Salem.utils.modalError({
            title: "Algo se ha roto",
            message: `Salem no ha podido resolver la ruta del panel:${url}.`,
          });
        });
      });
    },
    parse: {
      dom: (string) => {
        return $(string);
      },
      json: (string) => {
        return typeof string == "object" ? string : JSON.parse(string);
      },
      plain: (string) => {
        return string;
      },
      csv: (string) => {
        return Papa.parse(string, { header: true, skipEmptyLines: true }).data;
      },
      form: (string) => {
        return Salem.utils.getFormValues(string, "dom");
      },
      info: async (string) => {
        let res = await Salem.core.runtime.getInfo({ dom: string });
        return res;
      },
      jsonToHtml: (json) => {
        let content = Object.keys(json)
          .map((key) => {
            key = key.toLowerCase();
            key.charAt(0).toUpperCase();
            return `${key}: ${json[key]}`;
          })
          .join("<br>");
        return content;
      },
    },
    router: (route) => {
      window.location.href = route;
    },
    getFormValues: (submitEvent, type, group) => {
      let data = null;
      if (typeof type == "undefined") {
        data = $(submitEvent.currentTarget).serializeArray();
      } else if (type == "dom") {
        data = $(submitEvent).find("form").serializeArray();
      } else if (type == "form") {
        data = $(submitEvent).serializeArray();
      }
      let res = group == true ? { original: {} } : {};
      data.forEach((key) => {
        if (group == true) {
          key.name.includes("Dynamic")
            ? (res.original[key.name] = key.value)
            : (res[key.name] = key.value);
        } else {
          res[key.name] = key.value;
        }
      });
      return res;
    },
    loading: (config) => {
      return new Promise(async (resolve) => {
        if (!config) {
          $(".is-loading").remove();
          resolve();
          return;
        }
        // Verificar si ya existe el modal de carga
        let el = $(".is-loading");
        if (el.length == 0) {
          let load = await Salem.utils.partials.get(
            Salem.rules.routes.load,
            config
          );
          $("body").append(load);
        } else {
          Object.keys(config).forEach((key) => {
            $(el).find(`[data-tag="${key}"]`).html(config[key]);
          });
        }
        resolve();
      });
    },
    modalError: async (config) => {
      await Salem.utils.loading();
      let error = await Salem.utils.partials.get(
        Salem.rules.routes.modalError,
        config
      );
      $('[data-tag="sidebar-content"]').html(error);
    },
    /**
     * Exporta datos a un archivo Excel (.xlsx) con formato profesional.
     * Utiliza la librería ExcelJS para aplicar estilos, centrado y auto-ajuste de columnas.
     * 
     * @param {Object} data - Objeto donde cada clave es el nombre de la hoja y el valor es un Array de Objetos con los datos.
     * @param {String} fileName - Nombre del archivo de salida.
     * @param {String} creator - Nombre del creador/módulo para los metadatos.
     */
    excelExport: async (data, fileName, creator = 'Salem') => {
      if (typeof ExcelJS === 'undefined') {
        throw new Error('La librería ExcelJS no está cargada.');
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = creator;
      workbook.created = new Date();

      for (const [sheetName, sheetRows] of Object.entries(data)) {
        if (!Array.isArray(sheetRows) || sheetRows.length === 0) continue;

        // 1. Obtener nombres de columnas y filtrar las que están completamente vacías
        const allKeys = Object.keys(sheetRows[0]);
        const validKeys = allKeys.filter(key => {
          const isInternal = ['key', 'deployment', 'status', 'index'].includes(key);
          const hasName = key && key.trim().length > 0;
          if (isInternal || !hasName) return false;

          // Verificar si al menos una fila tiene datos en esta columna
          return sheetRows.some(row => {
            const val = row[key];
            return val !== null && val !== undefined && String(val).trim() !== '';
          });
        });

        if (validKeys.length === 0) continue;

        // 2. Crear hoja y definir columnas
        const safeSheetName = sheetName.substring(0, 31).replace(/[\/?*\[\]]/g, '');
        const worksheet = workbook.addWorksheet(safeSheetName);

        worksheet.columns = validKeys.map(key => ({
          header: String(key).toUpperCase(),
          key: key,
          width: 15
        }));

        // 3. Agregar datos
        sheetRows.forEach(row => {
          const cleanRow = {};
          validKeys.forEach(key => cleanRow[key] = row[key]);
          worksheet.addRow(cleanRow);
        });

        // 4. Aplicar Estilos (Encabezados y Celdas)
        const headerRow = worksheet.getRow(1);
        headerRow.height = 20;

        worksheet.columns.forEach((col, i) => {
          const cell = headerRow.getCell(i + 1);
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' } // Azul profesional
          };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = {
            top: { style: 'thin' }, left: { style: 'thin' },
            bottom: { style: 'thin' }, right: { style: 'thin' }
          };
        });

        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber > 1) {
            row.alignment = { horizontal: 'center', vertical: 'middle' };
            worksheet.columns.forEach((col, i) => {
              const cell = row.getCell(i + 1);
              if (cell) {
                cell.border = {
                  top: { style: 'thin' }, left: { style: 'thin' },
                  bottom: { style: 'thin' }, right: { style: 'thin' }
                };
              }
            });
          }
        });

        // 5. Auto-ajustar ancho de columnas
        worksheet.columns.forEach((column, index) => {
          let maxLength = column.header ? column.header.length : 10;
          worksheet.eachRow({ includeEmpty: false }, (row) => {
            const cell = row.getCell(index + 1);
            if (cell.value) {
              const cellLength = cell.value.toString().length;
              if (cellLength > maxLength) maxLength = cellLength;
            }
          });
          column.width = Math.min(Math.max(maxLength + 2, 10), 200);
        });
      }

      if (workbook.worksheets.length > 0) {
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        window.URL.revokeObjectURL(url);
        return true;
      }
      return false;
    },
    /**
     * Despliega un mensaje emergente en pantalla (bottomRight)
     * @param {JSON} config
     * Se espera tener {title, message, type, timeout?}
     */
    toast: (config) => {
      return new Promise(async (resolve) => {
        await Salem.utils.loading();
        if (config.interactive) {
          // El elemento a mostrar es una vista parcial HTML
          let route = Salem.utils.getValueByRef(config.partial, Salem);
          config.message = await Salem.utils.partials.get(route, config);
        }

        let container = $("<div/>");
        if (typeof config.message == "object") {
          $.each(config.message, function (i, val) {
            container.append(val);
          });
        }
        if (config.display == "swal") {
          await Swal.fire({
            title: config.title,
            html:
              typeof config.message == "object"
                ? container.html()
                : config.message,
            ...Salem.utils.swal.getDefault(),
            ...config.custom,
          });
          resolve();
        } else {
          setTimeout(() => {
            new Notify({
              status: config.type ? config.type : "info",
              title: config.title,
              text:
                typeof config.message == "object"
                  ? container.html()
                  : config.message,
              effect: "slide",
              speed: 200,
              customClass: config.type == "success" ? "tx-light" : "tx-dark",
              customIcon: `<img src="${chrome.runtime.getURL(
                "icons/salem_48x48.png"
              )}" alt="logo" width="48px">`,
              showIcon: true,
              showCloseButton: true,
              autoclose: config.noHide ? false : true,
              autotimeout: 2000,
              gap: 20,
              distance: window.location.href.includes("/otobo/") ? 305 : 10,
              type: 2,
              position: config.isTop ? "right top" : "right bottom",
            });
            resolve();
          }, 250);
        }
      });
    },
    /**
     * Copia un texto al portapapeles.
     * @param {String} text - Texto a copiar
     * @param {Boolean} showToast - Indica si se mostrará un mensaje emergente
     * @returns
     */
    clipboard: (text, showToast) => {
      return new Promise(async (resolve) => {
        const el = document.createElement("textarea");
        el.value = Salem.utils.htmlToText(text);
        el.setAttribute("readonly", "");
        el.style.position = "absolute";
        el.style.left = "-9999px";
        document.body.appendChild(el);
        const selected =
          document.getSelection().rangeCount > 0
            ? document.getSelection().getRangeAt(0)
            : false;
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        if (selected) {
          document.getSelection().removeAllRanges();
          document.getSelection().addRange(selected);
        }
        if (showToast) {
          Salem.utils.toast({
            title: "Portapapeles",
            message: "Se ha establecido nuevo contenido en el portapapeles",
            type: "info",
            timeout: 3000,
          });
        }
        resolve();
      });
    },
    htmlToText: (string) => {
      let tmp = document.createElement("div");
      tmp.innerHTML = string;
      string = tmp.textContent || tmp.innerText || "";
      tmp.remove();
      string = string.trim();
      return string;
    },
    partials: {
      /**
       * Obtiene una vista parcial y le asigna los elementos que vengan en Body. El elemento parcial debe tener los atributos data-tag="key"
       * @param {String} route
       * @param {JSON} body
       * @returns
       */
      get: async (route, body) => {
        let url = chrome.runtime.getURL(route);
        let res = await Salem.utils.ajax(url, "dom");
        Object.keys(body).forEach((key) => {
          if (key == "src") {
            $(res)
              .find(`[data-tag="${key}"]`)
              .attr(
                "src",
                body[key].replaceAll("salemsrc", chrome.runtime.getURL(""))
              );
          } else {
            $(res).find(`[data-tag="${key}"]`).html(body[key]);
            $(res)
              .find(`[data-interactive="${key}"]`)
              .attr("data-interactive", body[key]);
          }
        });
        return res;
      },
      getSetPanel: async (panel) => {
        let resources = Salem.rules.routes.panels[panel];
        let middleware =
          resources && resources.middleware
            ? await Salem.otrs.middleware(resources.middleware)
            : true;
        $('[data-sidebar="title"]').html(resources.title);
        $('[data-sidebar="message"]').html(resources.message);
        if (middleware) {
          let body = await Salem.utils.partials.get(resources.view, []);
          $('[data-tag="sidebar-content"]').html(body);
          if (resources.script)
            Salem.utils.partials.injectScript(resources.script);
        }
        Salem.utils.loading();
      },
      injectScript: (route) => {
        const script = document.createElement("script");
        script.setAttribute("tag-name", "partialScript");
        script.setAttribute("src", chrome.runtime.getURL(route));
        const head =
          document.head ||
          document.getElementsByTagName("head")[0] ||
          document.documentElement;
        head.insertBefore(script, head.lastChild);
      },
    },
    environ: {
      setDev: () => {
        return new Promise(async (resolve) => {
          let storage = await Salem.core.mem.get();
          let access = await Salem.core.api(
            { action: "utils", subaction: "getToken" },
            true
          );
          !storage
            ? (storage = { dev: access.token })
            : (storage.dev = access.token);
          await Salem.core.mem.set(storage);
          resolve();
        });
      },
      setProd: () => {
        return new Promise(async (resolve) => {
          let storage = await Salem.core.mem.get();
          storage ? (storage.dev = undefined) : null;
          await Salem.core.mem.set(storage);
          resolve();
        });
      },
    },
  },
  rules: {
    storage: "salemMemory",
    api: {
      dev: "https://script.google.com/macros/s/AKfycbw9iEQ5I8ZXqHyMG8KbvkSKqP9CLkc7UKGeYMFk9WY/dev?access_token=",
      prod: "https://script.google.com/macros/s/AKfycbxIjCSxv1abCQE0kk4BWALYSsM3HuHd1kvlHu2a41JSnAJfOVmB1-kXBqp7oEgmdKO5/exec",
    },
    routes: {
      otrs: "https://helpdesk.rbsas.co/otobo/index.pl",
      login: "/sources/popup/login/login.html",
      sidebar: "/sources/popup/sidebar/sidebar.html",
      load: "/sources/client/modals/loading/loading.html",
      modalError: "/sources/client/modals/error/error.html",
      panels: {
        error: {
          view: "/sources/popup/menus/toolkit/error/error.html",
          script: "/sources/popup/menus/toolkit/error/error.js",
          title: "Error de panel",
          message: "El panel solicitado no está disponible.",
        },
        sync: {
          view: "/sources/popup/menus/toolkit/sync/sync.html",
          script: "/sources/popup/menus/toolkit/sync/sync.js",
          title: "Sincronizar",
          message: "Actualizar parámetros estructurales.",
        },
        about: {
          view: "/sources/popup/menus/toolkit/about/about.html",
          script: "/sources/popup/menus/toolkit/about/about.js",
          title: "Acerca de Salem",
          message: "Infórmese de los cambios aplicados al app.",
        },
        default: {
          view: "/sources/popup/menus/toolkit/default/default.html",
          title: "Bienvenido(a)",
          message: "Elige un panel para empezar",
        },
        preventivos: {
          view: "/sources/popup/menus/planes/preventivos/preventivos.html",
          script: "/sources/popup/menus/planes/preventivos/preventivos.js",
          title: "Mantenimiento preventivo",
          message: "Genere tickets nuevos para mantenimientos preventivos.",
          middleware: { isOTRS: "", isAlive: "" },
        },
        mttoEspeciales: {
          view: "/sources/popup/menus/planes/mttoEspeciales/mttoEspeciales.html",
          script: "/sources/popup/menus/planes/mttoEspeciales/mttoEspeciales.js",
          title: "Mantenimiento rutinario Especial",
          message: "Genere tickets nuevos para mantenimientos rutinarios especiales.",
          middleware: { isOTRS: "", isAlive: "" },
        },
        rutinarios: {
          view: "/sources/popup/menus/planes/rutinarios/rutinarios.html",
          script: "/sources/popup/menus/planes/rutinarios/rutinarios.js",
          title: "Mantenimiento rutinario",
          message: "Genere tickets nuevos para mantenimientos rutinarios.",
          middleware: { isOTRS: "", isAlive: "" },
        },
        bulk: {
          view: "/sources/popup/menus/utils/bulk/bulk.html",
          script: "/sources/popup/menus/utils/bulk/bulk.js",
          title: "Bulk",
          message: "Visualice múltiples tickets de OTOBO de manera simultánea.",
        },


        sweep: {
          view: "/sources/popup/menus/utils/sweep/sweep.html",
          script: "/sources/popup/menus/utils/sweep/sweep.js",
          title: "Traza de estados",
          message:
            "Realice cambios de estado de acuerdo al árbol de secuencias establecido.",
          middleware: { isOTRS: "", isZoom: "" },
        },
        updateRutinarios: {
          view: "/sources/popup/menus/utils/updateRutinarios/updateRutinarios.html",
          script: "/sources/popup/menus/utils/updateRutinarios/updateRutinarios.js",
          title: "Cargar Mtto Rutinarios",
          message:
            "Carga los mantenimientos rutinarios de manera automatica.",
          middleware: { isOTRS: "" },
        },
        updatePreventivos: {
          view: "/sources/popup/menus/utils/updatePreventivos/updatePreventivos.html",
          script: "/sources/popup/menus/utils/updatePreventivos/updatePreventivos.js",
          title: "Cargar Mtto Preventivos",
          message:
            "Reporte los equipos de mantenimiento preventivo que no se encuentran en OTOBO.",
          middleware: { isOTRS: "" },
        },
        updateCheckRutinarios: {
          view: "/sources/popup/menus/utils/updateCheckRutinarios/updateCheckRutinarios.html",
          script: "/sources/popup/menus/utils/updateCheckRutinarios/updateCheckRutinarios.js",
          title: "Verificar Mtto Rutinarios",
          message:
            "Visualice y verifique los mantenimientos rutinarios.",
          middleware: { isOTRS: "" },
        },
        preferences: {
          view: "/sources/popup/menus/toolkit/preferences/preferences.html",
          script: "/sources/popup/menus/toolkit/preferences/preferences.js",
          title: "Preferencias",
          message: "Establezca las preferencias de su usuario.",
        },
        report: {
          view: "/sources/client/modals/report/report.html",
          title: "Reportar Novedad",
          message: "Envíe un reporte de novedad vía correo electrónico."
        },
        close: {
          view: "/sources/popup/menus/utils/close/close.html",
          script: "/sources/popup/menus/utils/close/close.js",
          title: "Cierre de tickets",
          message: "Resuelva tickets de preventivos y rutinarios.",
          middleware: {
            isOTRS: "",
            isZoom: "",
            isState: [
              "PROGRESO MTTO PREVENTIVO",
              "EN PROGRESO"

            ]
          },
        },
      },
    },
  },
};

if (typeof window != "undefined") Salem.core.listen();
