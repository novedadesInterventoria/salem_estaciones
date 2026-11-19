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
      /**
       * @description Verifica la existencia de tickets duplicados en OTOBO para un conjunto de equipos de forma secuencial.
       *
       * @param {Array<Object>} packageList - Lista de paquetes que contienen las propiedades cmdb y create de cada equipo.
       * @param {Object} [customStorage] - Objeto de configuración en memoria con las reglas de búsqueda de duplicidad.
       *
       * @returns {Promise<Array<Object>>} Promesa que resuelve la lista de paquetes enriquecida con la propiedad hasDuplicity.
       */
      checkDuplicity: (packageList, customStorage) => {
        return new Promise(async (resolve) => {
          let storageObj = customStorage;
          if (!storageObj && typeof storage !== "undefined") {
            storageObj = storage;
          }
          if (!storageObj) {
            storageObj = await Salem.core.mem.get();
          }
          let res = [];
          for (let u of packageList) {
            await Salem.utils.loading({
              title: "Verificando duplicidad",
              message: `Se está verificando duplicidad para el equipo ${u.cmdb.equipo} ${u.cmdb.name} de ${u.cmdb.estacion}`
            });
            let baseSearch = storageObj && storageObj.config && storageObj.config.utils && storageObj.config.utils.checkDuplicity;
            let search = baseSearch ? { ...baseSearch } : {};
            search.Search_DynamicField_IDEQUIPO = u.cmdb.name;
            search.Title = `"${u.cmdb.asunto}"`;
            search.ServiceIDs = [u.create.service_id];
            let hasDuplicity = await Salem.otrs.ajax(search);
            res.push({ ...u, hasDuplicity: hasDuplicity || [] });
          }
          resolve(res);
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
           * Completa los campos del formulario AgentTicketPhone6 para crear tickets
           * de Centro de Control / Fiscalizador.
           *
           * Obligatorios en createFields: {...cmdb, asunto, cuerpo}
           *   → name, equipo, estacion, ubicacion
           *
           * Obligatorios en createParams: Registro CREATE de hoja CLOE para FISCALIZADOR
           *   → requerimiento, type_id, service_id, sla_id, priority_id
           *
           * Opcional en createFields: padre (TicketID del ticket padre)
           *
           * @param {JSON} form          - Formulario HTML de AgentTicketPhone6 parseado como JSON.
           * @param {JSON} createFields  - Datos del equipo/CMDB (incluye asunto y cuerpo ya calculados).
           * @param {JSON} createParams  - Parámetros del registro CREATE de CLOE para FISCALIZADOR.
           * @returns {JSON}             - Formulario completado listo para enviar a Salem.otrs.ajax.
           */
          fiscalizador: (form, createFields, createParams) => {
            // Enlace con ticket padre (opcional)
            form.LinkTicketID = createFields.padre ? createFields.padre : "";
            form.TicketID = createFields.padre ? createFields.padre : "";

            // Datos del cliente — iguales al flujo de Estaciones
            form.SelectedCustomerUser = "festacion";
            form.CustomerSelected = "1";
            form.CustomerKey_1 = "festacion";
            form.CustomerTicketText_1 = '"FUNCIONARIO ESTACION RECAUDO BOGOTA" <control@rbsas.co>';
            form.CustomerTicketCounterFromCustomer = "1";
            form.CustomerID = "RB CLIENTE INTERNO";

            // Cola destino
            form.Dest = "22||RB::MESA DE SERVICIOS";

            // ── Campos específicos de Centro de Control / Fiscalizador ──────────
            // Equipo: campo propio del formulario AgentTicketPhone6
            form.DynamicField_EQUIPOCC = createFields.equipo;

            // Categoría correcta para Centro de Control (≠ "EQUIPO ESTACIONES")
            form.DynamicField_CATEGORIATICKET = "CENTRO DE CONTROL T.M S.A";

            // Requerimiento desde CREATE
            form.DynamicField_REQUERIMIENTOSOPORTE = createParams.requerimiento;

            // Ubicación/estación: campo propio de AgentTicketPhone6
            form.DynamicField_UBICACIONEQUIPOCC = createFields.estacion;

            // ID del equipo (campo compartido con otros formularios de OTOBO)
            form.DropIDEquipo = createFields.name;
            form.DynamicField_IDEQUIPO = createFields.name;
            // ────────────────────────────────────────────────────────────────────

            // Parámetros de servicio — vienen exclusivamente de CREATE (hoja CLOE)
            form.TypeID = createParams.type_id;
            form.ServiceID = createParams.service_id;
            form.SLAID = createParams.sla_id;
            form.PriorityID = createParams.priority_id;

            // Estado inicial explícito → 34 = NUEVO
            // Se establece aquí para no depender del valor por defecto del HTML del formulario
            form.NextStateID = "34";

            // Asunto y cuerpo calculados en fiscalizadores.js antes de llamar esta función
            form.Subject = createFields.asunto;
            form.Body = createFields.cuerpo.replaceAll("\n", "<br/>");

            // Campos de control Salem
            form.Cargado = "1";
            form.transform = "info";

            // Si el llamador envió campos originales, sobrescribir al final
            if (createFields.original)
              form = { ...form, ...createFields.original };

            return form;
          },
          /**
           * @description Completa los campos del formulario de creación de tickets para flota/móviles.
           *
           * @param {Object} form         - Formulario base de OTOBO serializado.
           * @param {Object} createFields - Campos calculados del equipo y del móvil.
           * @param {Object} createParams - Parámetros de servicio y prioridad desde la hoja CLOE.
           * @param {Object} storage      - Almacenamiento local con configuración y sesión activa.
           *
           * @returns {Object} Formulario enriquecido listo para enviar a OTOBO.
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
    /**
     * @description Envía una solicitud AJAX autenticada hacia la API de OTOBO incluyendo el ChallengeToken.
     * Soporta transformación automática de respuesta a DOM sanitizado, formulario o JSON.
     *
     * @param {Object} payload       - Parámetros y acciones de OTOBO (Action, TicketID, etc.).
     * @param {string} [token]       - ChallengeToken explícito opcional.
     *
     * @returns {Promise<any>} Respuesta procesada de OTOBO o null si falla la autenticación.
     */
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
            let processed = (typeof res === "string" && (payload.transform === "dom" || payload.transform === "form" || payload.transform === "info"))
              ? Salem.utils.cleanCspHtml(res)
              : res;
            let result = payload.transform
              ? Salem.utils.parse[payload.transform](processed)
              : processed;
            resolve(result);
          },
        });
      });
    },
    /**
     * @description Adjunta uno o varios archivos a un formulario abierto de OTOBO vía AjaxAttachment.
     *
     * @param {Array<File>} files - Lista de archivos a subir.
     * @param {Object}      form  - Formulario que contiene FormID y ChallengeToken.
     * @param {string|Array<Object>} name - Nombre(s) a asignar a los archivos subidos.
     *
     * @returns {Promise<Object>} Respuesta del servidor OTOBO tras la carga.
     * @throws {Error} Si la solicitud AJAX de subida falla.
     */
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
      /**
       * @description Sincroniza el historial y eventos del ticket consultando las notas y artículos en OTOBO.
       *
       * @param {Object|string} info - Datos del ticket o número de ticket.
       *
       * @returns {Promise<Array<Object>>} Lista de eventos y notas del ticket.
       */
      sync: (info) => {
        return new Promise(async (resolve) => {
          let ticketNum = "";
          let ticketId = "";
          if (typeof info === "object" && info !== null) {
            ticketNum = info.ticket || info.TicketNumber || info["Ticket Número"] || "";
            ticketId = info.id || info.TicketID || "";
          } else if (typeof info === "string") {
            ticketNum = info;
          }

          let res = [];
          if (ticketNum || ticketId) {
            let searchPayload = {
              Action: "AgentTicketSearch",
              Subaction: "Search",
              ResultForm: "CSV",
              transform: "csv"
            };
            if (ticketNum) {
              searchPayload.TicketNumber = ticketNum;
            }
            if (ticketId) {
              searchPayload.TicketID = ticketId;
            }
            res = await Salem.otrs.ajax(searchPayload);
          }

          // Fallback automático: si CSV viene vacío (0 resultados), leer desde DOM
          if (!res || !Array.isArray(res) || res.length === 0) {
            try {
              let domInfo = await Salem.core.runtime.getInfo();
              if (domInfo && (domInfo.ticket || domInfo.id)) {
                res = [{
                  "Ticket Número": domInfo.ticket || ticketNum || "",
                  "Estado": domInfo.Estado || "",
                  "Servicio": domInfo.Servicio || "",
                  "Cola": domInfo.Cola || "",
                  "¿Quién Gestiona?": domInfo["¿Quién Gestiona?"] || "",
                  "ID Equipo": domInfo["ID Equipo"] || "",
                  "Estación": domInfo["Estación"] || "",
                  "Asunto": domInfo.rotulo || domInfo.titulo || "",
                  ...domInfo
                }];
              }
            } catch (domErr) {
              console.warn("Salem :: Fallback DOM en sync error:", domErr);
            }
          }

          resolve(res || []);
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
    /**
     * @description Envía un mensaje desde la ventana emergente/sidebar hacia la pestaña activa de OTOBO.
     *
     * @param {Object} message - Mensaje con la acción y parámetros requeridos.
     *
     * @returns {Promise<any>} Respuesta resuelta por el listener de la pestaña.
     */
    emit: (message) => {
      return new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
          console.error("[SALEM][EMIT] chrome.runtime no disponible");
          resolve(undefined);
          return;
        }
        let searchParams = window.location.search;
        let query = new URLSearchParams(searchParams);
        let tabId = parseInt(query.get("tabId"));
        if (tabId && !isNaN(tabId)) {
          chrome.tabs.sendMessage(tabId, message, (res) => {
            let lastError = chrome.runtime.lastError;
            if (lastError) {
              console.error(`[SALEM][EMIT] Error enviando mensaje al tabId ${tabId}:`, lastError.message);
              resolve(undefined);
              return;
            }
            resolve(res);
          });
        } else {
          console.error("[SALEM][EMIT] No se encontró un tabId válido en la URL para dirigir la operación. No se usará fallback a activeTab.");
          resolve(undefined);
        }
      });
    },
    /**
     * @description Inicializa la escucha de eventos y mensajes en el contexto de la pestaña de OTOBO.
     * Verifica la sesión del usuario, sincronización periódica y disparadores MRA en tiempo real.
     *
     * @returns {Promise<void>}
     */
    listen: async () => {
      console.log("%c[Salem] listen() iniciado en:", "color:#6f42c1;font-weight:bold", window.location.href);
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

        // Función auxiliar para calcular la firma de datos relevantes del ticket
        /**
         * @description Genera un hash/firma textual de los campos críticos del ticket para detectar cambios de estado.
         *
         * @param {Object} info - Información del ticket activo.
         *
         * @returns {string} Firma concatenada del ticket.
         */
        function getTicketSignature(info) {
          if (!info || !info.ticket) return "";
          return [
            info.ticket,
            info.Estado || "",
            info.first_prog || "",
            info.last_prog || "",
            info.resuelto || "",
            info.anulado || "",
            (info.partes ? info.partes.length : 0),
            info["¿Quién Gestiona?"] || "",
            info.Cola || "",
            info.Servicio || "",
            info.Prioridad || ""
          ].join("|");
        }

        let lastMraSignature = "";
        let info = await Salem.core.runtime.getInfo();
        if (info && info.isZoom) {
          lastMraSignature = getTicketSignature(info);
          Salem.core.runtime.mra(storage, info);
        }

        // --- Detección en tiempo real de acciones directas en OTOBO ---
        let updateTimer = null;
        let lastExecutionTime = 0;
        const MIN_INTERVAL = 3000; // Throttle: mínimo 3s entre ejecuciones de MRA

        /**
         * @description Programa una verificación diferida y con limitación de frecuencia (throttle)
         * para registrar actualizaciones directas en OTOBO hacia la hoja MRA.
         *
         * @param {string} source       - Origen o descripción del evento desencadenante.
         * @param {number} [delay=1500] - Tiempo de espera en milisegundos para el debounce.
         *
         * @returns {void}
         */
        function scheduleOtoboUpdate(source, delay = 1500) {
          if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
            return;
          }
          if (updateTimer) {
            clearTimeout(updateTimer);
          }
          updateTimer = setTimeout(async () => {
            updateTimer = null;
            if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
              return;
            }
            let now = Date.now();
            if (now - lastExecutionTime < MIN_INTERVAL) {
              return;
            }
            try {
              let storage = await Salem.core.mem.get();
              if (!storage || !storage.login || !storage.config || !storage.config.mra) {
                return;
              }
              // Leer SIEMPRE la información real y fresca del DOM de OTOBO
              let info = await Salem.core.runtime.getInfo();
              if (info && info.isZoom) {
                let currentSignature = getTicketSignature(info);
                // Si la firma cambió o si fue un submit/click explícito, disparar MRA
                if (currentSignature !== lastMraSignature || source === "submit" || source === "click") {
                  lastMraSignature = currentSignature;
                  lastExecutionTime = Date.now();
                  await Salem.core.runtime.mra(storage, info);
                }
              }
            } catch (err) {
              // Silencioso
            }
          }, delay);
        }

        // 1. Detección de envíos de formularios OTOBO (sin preventDefault)
        $(document).on("submit", "form", () => {
          scheduleOtoboUpdate("submit", 1500);
        });

        // 2. Detección de clicks en botones de acción o envío de ticket
        $(document).on(
          "click",
          "#submitRichText, #Submit, button[type='submit'], input[type='submit'], .CallForAction",
          () => {
            scheduleOtoboUpdate("click", 1500);
          }
        );

        // 3. Mecanismo de recuperación ante retorno de foco/visibilidad
        window.addEventListener("focus", () => {
          scheduleOtoboUpdate("focus", 1000);
        });
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            scheduleOtoboUpdate("visibility", 1000);
          }
        });
      }

      // Agregar escuchadores y utilidades
      $(document).on("click", ".is-otrs", (e) =>
        Salem.core.runtime.zoomTicket($(e.currentTarget).text())
      );





    },
    /**
     * @description Comprueba si ha vencido el período de sincronización y dispara la actualización automática.
     *
     * @param {Object} storage - Almacenamiento local con timestamp syncDate.
     *
     * @returns {Promise<void>}
     */
    checkSync: async (storage) => {
      let ahora = Date.now();
      if (storage && storage.syncDate && ahora >= storage.syncDate)
        Salem.core.runtime.sync();
    },

    runtime: {
      /**
       * @description Enruta y envía los datos del ticket activo hacia la hoja de auditoría MRA en Google Sheets.
       *
       * @param {Object} storage - Almacenamiento con configuración y sesión.
       * @param {Object} info    - Datos del ticket inspeccionado en OTOBO Zoom.
       *
       * @returns {Promise<void>}
       */
      mra: async (storage, info) => {
        storage =
          storage && storage.config ? storage : await Salem.core.mem.get();
        info = info && info.isZoom ? info : await Salem.core.runtime.getInfo();

        // Fallback de alias para Fiscalizadores / Centro de Control
        if (info) {
          if (!info["Estación"] && (info["Centro de Control"] || info["Ubicación Centro de Control"] || info["Ubicación Equipo Centro de Control"] || info["Ubicación Equipo CC"])) {
            info["Estación"] = info["Centro de Control"] || info["Ubicación Centro de Control"] || info["Ubicación Equipo Centro de Control"] || info["Ubicación Equipo CC"];
          }
          if (!info["Equipo Estación"] && (info["Equipo Centro de Control"] || info["Equipo CC"] || info["Equipo"])) {
            info["Equipo Estación"] = info["Equipo Centro de Control"] || info["Equipo CC"] || info["Equipo"];
          }
          if (!info["ID Equipo"] && (info["ID Móvil"] || info["ID Equipo Centro de Control"] || info["ID Equipo CC"] || info["ID"])) {
            info["ID Equipo"] = info["ID Móvil"] || info["ID Equipo Centro de Control"] || info["ID Equipo CC"] || info["ID"];
          }
        }

        let package = [];
        for (let key of Object.keys(storage.config.mra)) {
          let regla = storage.config.mra[key];
          counter = 0;
          regla.verificaciones.forEach((criterio) => {
            let valorEnInfo = info[criterio.campo];
            if (valorEnInfo) {
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
                case "includes": {
                  let vA = String(info[criterio.campo] || "").trim();
                  let vB = String(criterio.valor || "").trim();
                  flag =
                    vA.includes(vB) ||
                    vA.replace(/\s*-\s*/g, "-").includes(vB.replace(/\s*-\s*/g, "-")) ||
                    vA.replace(/\s+/g, " ").includes(vB.replace(/\s+/g, " "));
                  break;
                }
                case "no_includes": {
                  let vA = String(info[criterio.campo] || "").trim();
                  let vB = String(criterio.valor || "").trim();
                  flag = !(
                    vA.includes(vB) ||
                    vA.replace(/\s*-\s*/g, "-").includes(vB.replace(/\s*-\s*/g, "-")) ||
                    vA.replace(/\s+/g, " ").includes(vB.replace(/\s+/g, " "))
                  );
                  break;
                }
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
            regla.show ? await Salem.utils.toast(regla.show) : null;
          }
        }
        if (package.length != 0) {
          console.log(
            `[SALEM][MRA][DELEGATED] Delegando evento a SW para ticket ${info.ticket || info.id || "desconocido"}`
          );
          if (
            typeof chrome !== "undefined" &&
            chrome.runtime &&
            chrome.runtime.sendMessage
          ) {
            chrome.runtime.sendMessage(
              {
                type: "SALEM_MRA",
                payload: {
                  package,
                  otrs: info,
                  config: storage.config.planes,
                },
              },
              (res) => {
                let err = chrome.runtime.lastError;
                if (err || !res || !res.received) {
                  console.error(
                    `[SALEM][MRA][SEND_FAILED] Error delegando MRA al SW:`,
                    err || res
                  );
                } else {
                  console.log(
                    `[SALEM][MRA][ACK] Evento persistido por SW: eventId=${res.eventId}, tabId=${res.tabId}`
                  );
                }
              }
            );
          } else {
            console.error(
              `[SALEM][MRA][SEND_FAILED] chrome.runtime.sendMessage no disponible`
            );
          }
        }
      },
      /**
       * @description Abre la vista de detalle (AgentTicketZoom) de un ticket en una nueva pestaña del navegador.
       *
       * @param {string|number} TicketNumber - Número del ticket a visualizar.
       *
       * @returns {void}
       */
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

      ////Traza creaciòn de tickets Fiscalizadores / Centro de Control/////

      /**
       * Realiza la traza de estados para Fiscalizadores / Centro de Control:
       * 1. NUEVO -> ASIGNADO A CAMPO usando AgentTicketPriority5 (incluyendo cambio de cola vía NewQueueID)
       * 2. ASIGNADO A CAMPO -> PROGRESO MTTO PREVENTIVO usando AgentTicketNote (si el destino es PROGRESO)
       * @param {JSON} info - Objeto JSON con los datos del ticket nuevo
       * @param {JSON} params - Parámetros de la traza: {firma, destino, nota, tcampo, hora}
       * @returns {Promise<Boolean>}
       */
      sweepFiscalizadores: (info, params) => {
        return new Promise(async (resolve) => {
          await Salem.utils.loading({
            title: "Realizando traza",
            message: "Se está ejecutando la traza de estados para Fiscalizador",
          });

          let storage = await Salem.core.mem.get();
          let cat =
            info["Categoría del Ticket"] &&
            info["Categoría del Ticket"].toLowerCase().includes("flota")
              ? "buses"
              : "no_buses";
          if (params.hora == "") params.hora = moment().format("HH:mm");

          // 1. Transición: NUEVO -> ASIGNADO A CAMPO usando AgentTicketPriority5
          let priorityForm = await Salem.otrs.ajax({
            type: "GET",
            transform: "form",
            Action: "AgentTicketPriority5",
            TicketID: info.id,
          });

          let notaAsignado =
            storage &&
            storage.config &&
            storage.config.sweep &&
            storage.config.sweep[cat] &&
            storage.config.sweep[cat].notas
              ? storage.config.sweep[cat].notas["ASIGNADO A CAMPO"]
              : null;

          if (priorityForm) {
            priorityForm.NewStateID =
              notaAsignado?.status_code || priorityForm.NewStateID;
            priorityForm.Subject =
              params.tcampo && notaAsignado
                ? notaAsignado.asunto
                    .replaceAll("$firma", storage.login.firma)
                    .replaceAll("$hora", params.hora)
                : (notaAsignado?.asunto || "ASIGNADO A CAMPO");
            priorityForm.Body =
              params.tcampo && notaAsignado
                ? notaAsignado.texto.replaceAll("$tcampo", params.tcampo)
                : (notaAsignado?.texto || "CAMBIO DE ESTADO");
            priorityForm.DynamicField_SEGUIMIENTO = storage.login.firma;
            priorityForm.DynamicField_QUIENGESTIONA = params.tcampo
              ? params.tcampo
              : storage.login.firma;
            priorityForm.DynamicField_INTERVENCION = "SI";

            // Modificar cola a MANTENIMIENTO PREVENTIVO usando NewQueueID si está disponible
            if (storage?.config?.queues?.list?.["MANTENIMIENTO PREVENTIVO"]) {
              priorityForm.NewQueueID =
                storage.config.queues.list["MANTENIMIENTO PREVENTIVO"];
            }

            if (params.tcampo) priorityForm.IsVisibleForCustomer = "on";

            await Salem.otrs.ajax({ transform: "form", ...priorityForm });
          }

          // Si el destino era solo ASIGNADO A CAMPO, verificar estado y resolver
          if (params.destino === "ASIGNADO A CAMPO") {
            let result = await Salem.otrs.middleware(
              { isState: "ASIGNADO A CAMPO" },
              info
            );
            resolve(result);
            return;
          }

          // 2. Transición: ASIGNADO A CAMPO -> PROGRESO MTTO PREVENTIVO usando AgentTicketNote
          if (params.destino === "PROGRESO MTTO PREVENTIVO") {
            let noteForm = await Salem.otrs.ajax({
              type: "GET",
              transform: "form",
              Action: "AgentTicketNote",
              TicketID: info.id,
            });

            let notaProgreso =
              storage &&
              storage.config &&
              storage.config.sweep &&
              storage.config.sweep[cat] &&
              storage.config.sweep[cat].notas
                ? storage.config.sweep[cat].notas["PROGRESO MTTO PREVENTIVO"]
                : null;

            if (noteForm) {
              noteForm.NewStateID =
                notaProgreso?.status_code || noteForm.NewStateID;
              noteForm.Subject =
                params.tcampo && notaProgreso
                  ? notaProgreso.asunto
                      .replaceAll("$firma", storage.login.firma)
                      .replaceAll("$hora", params.hora)
                  : (notaProgreso?.asunto || "PROGRESO MTTO PREVENTIVO");
              noteForm.Body = params.nota
                ? params.nota
                : params.tcampo && notaProgreso
                  ? notaProgreso.texto.replaceAll("$tcampo", params.tcampo)
                  : (notaProgreso?.texto || "PROGRESO MTTO PREVENTIVO");
              noteForm.DynamicField_QUIENGESTIONA = params.tcampo
                ? params.tcampo
                : storage.login.firma;
              noteForm.DynamicField_SEGUIMIENTO = storage.login.firma;
              noteForm.DynamicField_INTERVENCION = "SI";
              noteForm.DynamicField_MOTIVONOINTERVENCION = "-";
              noteForm.DynamicField_DESCRIPCION = "-";
              noteForm.IsVisibleForCustomer = "on";

              await Salem.otrs.ajax({ transform: "form", ...noteForm });
            }

            let result = await Salem.otrs.middleware(
              { isState: "PROGRESO MTTO PREVENTIVO" },
              info
            );
            resolve(result);
            return;
          }

          resolve(true);
        });
      },

      ////Traza creaciòn de tickets/////

      /**
       * @description Ejecuta la traza de estados inicial tras la creación de un ticket en OTOBO.
       *
       * @param {Object} info   - Información del ticket recién creado.
       * @param {Object} params - Parámetros de transición (firma, destino, nota, tcampo, hora).
       *
       * @returns {Promise<boolean>} Verdadero si la traza se completó exitosamente.
       */
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
            let isProgreso =
              jumps.cross[i] == "PROGRESO MTTO PREVENTIVO" ||
              (nota && nota.status_code == "36");

            let targetForm = form;
            if (isProgreso) {
              let noteForm = await Salem.otrs.ajax({
                type: "GET",
                transform: "form",
                Action: "AgentTicketNote",
                TicketID: info.id,
              });
              if (noteForm) targetForm = noteForm;
            }

            targetForm.Body =
              params.nota && jumps.cross[i] == params.destino
                ? params.nota
                : params.tcampo
                  ? nota.texto.replaceAll("$tcampo", params.tcampo)
                  : "CAMBIO DE ESTADO";
            targetForm.Subject = params.tcampo
              ? nota.asunto
                  .replaceAll("$firma", storage.login.firma)
                  .replaceAll("$hora", params.hora)
              : "CAMBIO DE ESTADO";
            targetForm.NewStateID = nota ? nota.status_code : (isProgreso ? "36" : targetForm.NewStateID);
            targetForm.DynamicField_QUIENGESTIONA = params.tcampo
              ? params.tcampo
              : storage.login.firma;
            targetForm.DynamicField_SEGUIMIENTO = storage.login.firma;
            targetForm.DynamicField_INTERVENCION = "SI";

            if (isProgreso) {
              targetForm.DynamicField_MOTIVONOINTERVENCION = "-";
              targetForm.DynamicField_DESCRIPCION = "-";
              targetForm.IsVisibleForCustomer = "on";
            } else {
              targetForm.SLAID = 11;
              // Poner cambio de técnico si es que el estado actual es igual al destino.
              targetForm.Subject =
                info.Estado == params.destino
                  ? `CAMBIO DE TÉCNICO`
                  : targetForm.Subject;

              // Definir si es nota externa
              params.tcampo ? (targetForm.IsVisibleForCustomer = "on") : null;
            }

            // Enviar info a OTOBO
            await Salem.otrs.ajax({ transform: "form", ...targetForm });

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

      /**
       * @description Ejecuta la traza estándar de cambio de estados para preventivos y rutinarios.
       *
       * @param {Object} info   - Información del ticket en proceso.
       * @param {Object} params - Parámetros de la transición de estado.
       *
       * @returns {Promise<boolean>} Verdadero si la transición de estados fue validada.
       */
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
            let isProgreso =
              jumps.cross[i] == "PROGRESO MTTO PREVENTIVO" ||
              (nota && nota.status_code == "36");

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
            form.NewStateID = nota ? nota.status_code : (isProgreso ? "36" : form.NewStateID);
            form.DynamicField_QUIENGESTIONA = params.tcampo
              ? params.tcampo
              : storage.login.firma;
            form.DynamicField_SEGUIMIENTO = storage.login.firma;
            form.DynamicField_INTERVENCION = "SI";

            if (isProgreso) {
              form.DynamicField_MOTIVONOINTERVENCION = "-";
              form.DynamicField_DESCRIPCION = "-";
              form.IsVisibleForCustomer = "on";
            } else {
              // Poner cambio de técnico si es que el estado actual es igual al destino.
              form.Subject =
                info.Estado == params.destino
                  ? `CAMBIO DE TÉCNICO`
                  : form.Subject;

              // Definir si es nota externa
              params.tcampo ? (form.IsVisibleForCustomer = "on") : null;
            }

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
      /**
       * @description Ejecuta la traza de estados especializada para mantenimientos especiales.
       *
       * @param {Object} info   - Información del ticket.
       * @param {Object} params - Parámetros de transición específicos.
       *
       * @returns {Promise<boolean>} Verdadero si la traza de estados especiales culminó con éxito.
       */
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
      /**
       * @description Recarga la ventana activa de OTOBO o emite la orden de recarga si se invoca desde el popup.
       *
       * @returns {Promise<void>}
       */
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
      /**
       * @description Extrae la información estructurada del ticket y de los campos dinámicos de la página activa de OTOBO.
       *
       * @param {Object} [req] - Objeto opcional con selector o DOM específico a analizar.
       *
       * @returns {Promise<Object>} Diccionario con los valores de los campos del ticket.
       */
      getInfo: (req) => {
        return new Promise(async (resolve, reject) => {
          try {
            let url = window.location.href;
            if (url.includes("/otobo/index.pl") || (req && typeof req.dom != "undefined")) {
              let campos = {};
              if (req && req.dom) {
                if (typeof req.dom === "string") {
                  let clean = Salem.utils.cleanCspHtml(req.dom);
                  let parser = new DOMParser();
                  let doc = parser.parseFromString(clean, "text/html");
                  req.dom = $(doc.body);
                } else {
                  req.dom = $(req.dom);
                }
              }

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
                let ticketNum = req && req.dom
                  ? req.dom.find('#TicketNumber, input[name="TicketNumber"]').val()
                  : $('#TicketNumber, input[name="TicketNumber"]').val();
                if (ticketNum) return ticketNum.trim();

                let headlineText = req && req.dom
                  ? req.dom.find(".Headline").text()
                  : $(".Headline").text();
                let match = headlineText.match(/(?:Ticket#|#\s*)(\d+)/i);
                if (match) return match[1].trim();

                let parts = headlineText.split(/[-—–]/);
                if (parts.length > 0) {
                  let ticketPart = parts[0].split("#");
                  if (ticketPart.length > 1) {
                    return ticketPart[1].trim();
                  }
                }
                return null;
              })();

              campos.id = (() => {
                // 1. TicketID en la URL actual (prioridad máxima: es el ticket que el agente está viendo)
                let urlMatch = window.location.href.match(/[?;&]TicketID=(\d+)/i);
                if (urlMatch) return urlMatch[1];

                // 2. Input oculto TicketID en formularios del ticket
                let ticketIdInput = req && req.dom
                  ? req.dom.find('input[name="TicketID"]').val()
                  : $('input[name="TicketID"]').val();
                if (ticketIdInput && /^\d+$/.test(ticketIdInput.trim())) {
                  return ticketIdInput.trim();
                }

                // 3. Enlaces de acción propios del ticket (.AsPopup, método original V1.2.3.4)
                let popupLinks = req && req.dom
                  ? req.dom.find(".AsPopup[href*='TicketID=']")
                  : $(".AsPopup[href*='TicketID=']");
                for (let el of popupLinks) {
                  let href = $(el).attr("href") || "";
                  let match = href.match(/[?;&]TicketID=(\d+)/i);
                  if (match) return match[1];
                }

                // 4. OTOBO Core.Config (variable JS global de OTOBO)
                try {
                  if (window.Core && window.Core.Config && typeof window.Core.Config.Get === "function") {
                    let id = window.Core.Config.Get("Ticket.TicketID");
                    if (id) return String(id);
                  }
                } catch (e) {}

                // 5. Buscar en scripts inline de la página
                try {
                  let scripts = document.querySelectorAll("script:not([src])");
                  for (let s of scripts) {
                    let m = s.textContent.match(/['"](TicketID|ticketId)['"]\s*[=:]\s*['"]*(\d+)/i);
                    if (m) return m[2];
                  }
                } catch (e) {}

                return null;
              })();

              campos.token = req && req.dom
                ? req.dom.find('input[name="ChallengeToken"]').val()
                : $('input[name="ChallengeToken"]').val();

              let labels = req && req.dom ? req.dom.find("label") : $("label");

              // Procesar etiquetas de campos en OTOBO
              if (labels.length > 0) {
                const excludedLabels = [
                  "Communication channel",
                  "Sender Type",
                  "Grabar configuración de filtros como defecto",
                  "Customer visibility",
                  "Creado por"
                ];

                labels.each(function () {
                  let labelText = $(this).text().trim().replace(/:$/, '').trim();
                  if (!labelText || excludedLabels.some(ex => labelText.includes(ex))) return;

                  let valP = $(this).next('p');
                  if (!valP.length) valP = $(this).siblings('p');
                  if (!valP.length) valP = $(this).next('.Value');
                  let valText = valP.text().trim();
                  if (valText) {
                    campos[labelText] = valText;
                  }
                });
              }

              // Normalizar alias comunes de OTOBO para consistencia con la API y MRA
              campos['ID Equipo'] = campos['ID Equipo'] || campos['ID Móvil'] || campos['ID Equipo Centro de Control'] || campos['ID Equipo CC'] || campos.DynamicField_IDEQUIPO || '';
              campos['Estación'] = campos['Estación'] || campos['Estacion'] || campos['Centro de Control'] || campos['Ubicación Centro de Control'] || campos['Ubicación Equipo Centro de Control'] || campos['Ubicación Equipo CC'] || campos['Patio'] || campos['Ubicación'] || campos['Ubicacion'] || campos.DynamicField_UBICACIONESTACION || '';
              campos['Equipo Estación'] = campos['Equipo Estación'] || campos['Equipo Centro de Control'] || campos['Equipo CC'] || campos['Equipo'] || campos.DynamicField_EQUIPOESTACION || '';
              campos['¿Quién Gestiona?'] = campos['¿Quién Gestiona?'] || campos['Quien Gestiona'] || campos.DynamicField_QUIENGESTIONA || '';

              // Fallback explícito de alias para Fiscalizadores / Centro de Control
              if (!campos["Estación"] && campos["Centro de Control"]) {
                campos["Estación"] = campos["Centro de Control"];
              }
              if (!campos["Equipo Estación"] && campos["Equipo Centro de Control"]) {
                campos["Equipo Estación"] = campos["Equipo Centro de Control"];
              }

              campos.Creado
                ? (campos.Creado = moment(
                  campos.Creado.replace(" - ", " "),
                  "DD/MM/YYYY HH:mm"
                ).format("YYYY-MM-DD HH:mm"))
                : (campos.Creado = undefined);

              campos.titulo = (() => {
                let headlineEl = req && req.dom ? req.dom.find(".Headline") : $(".Headline");
                return headlineEl.length ? headlineEl.text().trim() : null;
              })();

              campos.rotulo = (() => {
                if (!campos.titulo) return null;
                // 1. Extraer después de Ticket#123456 — o Ticket#123456 -
                let match = campos.titulo.match(/(?:Ticket#\s*\d+|#\s*\d+|\b\d{7,}\b)\s*[-—–]\s*([\s\S]+)$/i);
                if (match && match[1]) {
                  return match[1].trim();
                }
                // 2. Extraer después del primer guion largo (—) o en-dash (–)
                let dashMatch = campos.titulo.match(/[—–]\s*([\s\S]+)$/);
                if (dashMatch && dashMatch[1]) {
                  return dashMatch[1].trim();
                }
                // 3. Extraer después del primer ' - ' (con espacios)
                let spaceDash = campos.titulo.match(/\s+-\s+([\s\S]+)$/);
                if (spaceDash && spaceDash[1]) {
                  return spaceDash[1].trim();
                }
                return campos.titulo.trim();
              })();
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
                      // Eliminar prefijos numéricos como "07 ", "07 - ", etc.
                      campoAnulado = asunto.replace(/^\d+[\s.\-_:]*/, "").trim();
                      break;
                    }
                  }
                  if (!campoAnulado && campos["Tipo de Falla"] && campos["Tipo de Falla"].toLowerCase().includes("anulado")) {
                    campoAnulado = campos["Tipo de Falla"].replace(/^\d+[\s.\-_:]*/, "").trim();
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
      /**
       * @description Sincroniza la configuración global de Salem descargándola desde Google Apps Script.
       *
       * @param {Object} [config] - Opciones adicionales de sincronización (ej. offDevices).
       *
       * @returns {Promise<Object|boolean>} Objeto storage actualizado o false si falló la sincronización.
       */
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
            if (typeof window !== "undefined" && window.SalemTecnicos && typeof window.SalemTecnicos.syncFromOTRS === "function") {
              window.SalemTecnicos.syncFromOTRS().catch((e) => console.warn("[SALEM][SYNC] Error sync técnicos:", e));
            }
            resolve(storage);
          } else {
            let errorMsg = (res && res.message) ? res.message : (typeof res === "string" ? res : JSON.stringify(res));
            Salem.utils.modalError({
              title: "Sincronización fallida",
              message: "El API ha respondido con un error: " + errorMsg,
            });
            resolve(false);
          }
        });
      },
    },
    mem: {
      /**
       * @description Obtiene el objeto de almacenamiento persistente de Salem desde chrome.storage.local.
       *
       * @returns {Promise<Object>} Datos almacenados en memoria.
       */
      get: () => {
        return new Promise((resolve) => {
          chrome.storage.local.get(Salem.rules.storage, (e) => {
            resolve(e[Salem.rules.storage]);
          });
        });
      },
      /**
       * @description Guarda el objeto de almacenamiento persistente de Salem en chrome.storage.local.
       *
       * @param {Object} e - Datos a persistir en memoria.
       *
       * @returns {Promise<void>}
       */
      set: (e) => {
        return new Promise((resolve) => {
          chrome.storage.local.set({ [Salem.rules.storage]: e }, () => {
            resolve();
          });
        });
      },
      /**
       * @description Limpia completamente los almacenes locales y sincronizados de la extensión.
       *
       * @returns {Promise<void>}
       */
      clear: () => {
        return new Promise((resolve) => {
          chrome.storage.sync.clear();
          chrome.storage.local.clear();
          resolve();
        });
      },
    },
    /**
     * @description Realiza peticiones HTTP POST hacia la API de Google Apps Script con reintento y fallback de entorno.
     *
     * @param {Object}  request     - Payload de la solicitud con propiedades action y subaction.
     * @param {boolean} [forceProd] - Si es verdadero, fuerza el uso del endpoint de producción omitiendo dev.
     *
     * @returns {Promise<Object>} Respuesta JSON parseada del backend.
     */
    api: (request, forceProd) => {
      return new Promise(async (resolve) => {
        try {
          let storage = await Salem.core.mem.get();
          let urlsToTry = [
            Salem.rules.api.prod,
            Salem.rules.api.workspace
          ];
          if (!forceProd && storage && storage.dev) {
            urlsToTry.unshift(`${Salem.rules.api.dev}${storage.dev}`);
          }

          // DEBUG: ver qué se está enviando a la API
          console.group("Salem.core.api → REQUEST");
          console.log("Action:", request.action, "| Subaction:", request.subaction);
          console.log("Payload completo:", JSON.stringify(request, null, 2));
          console.groupEnd();

          let lastErrorMsg = "";
          for (let apiUrl of urlsToTry) {
            if (!apiUrl) continue;
            try {
              let response = await fetch(apiUrl, {
                method: request.type ? request.type : "POST",
                headers: {
                  "Content-Type": "text/plain;charset=utf-8",
                },
                body: JSON.stringify(request),
                redirect: "follow",
              });

              // DEBUG: ver respuesta cruda
              console.group("Salem.core.api ← RESPONSE [" + apiUrl.substring(0, 60) + "...]");
              console.log("HTTP status:", response.status, response.statusText);

              if (response.ok) {
                let textData = await response.text();
                console.log("Texto crudo (primeros 500 chars):", textData.substring(0, 500));
                let parsed;
                try {
                  parsed = JSON.parse(textData);
                } catch (e) {
                  parsed = { done: false, message: "Respuesta no es JSON: " + textData.substring(0, 200) };
                }
                resolve(parsed);
                return;
              } else {
                lastErrorMsg = `Error en API (${response.status}): ${response.statusText}`;
              }
            } catch (fetchErr) {
              lastErrorMsg = fetchErr && fetchErr.message ? fetchErr.message : "Error de red";
            }
          }

          resolve({ done: false, message: lastErrorMsg || "Error de conexión con API" });
        } catch (error) {
          resolve({ done: false, message: error && error.message ? error.message : "Error de conexión con API" });
        }
      });
    },
  },
  utils: {
    /**
     * @description Convierte una ruta relativa interna en una URL absoluta de la extensión Chrome.
     *
     * @param {string} path - Ruta relativa del archivo.
     *
     * @returns {string} URL absoluta con esquema chrome-extension://.
     */
    getFullPath: (path) => {
      return chrome.runtime.getURL(path);
    },
    checker: {
      /**
       * @description Determina si la ventana actual corresponde a una página del sistema OTOBO.
       *
       * @returns {boolean} Verdadero si la URL incluye '/otobo/'.
       */
      isOTRS: () => {
        return window.location.href.includes("/otobo/");
      },
    },
    /**
     * @description Resuelve y obtiene el valor anidado en un objeto a partir de una ruta con notación de puntos.
     *
     * @param {string} e         - Ruta de acceso con puntos (ej. 'config.planes.active').
     * @param {Object} reference - Objeto raíz donde buscar la propiedad.
     *
     * @returns {any} Valor de la propiedad anidada o undefined.
     */
    getValueByRef: (e, reference) => {
      let valueReferenced = e.split(".").reduce(function (prev, next) {
        return prev && prev[next];
      }, reference);
      return valueReferenced;
    },
    swal: {
      /**
       * @description Muestra una alerta modal interactiva utilizando SweetAlert2 con configuración predefinida.
       *
       * @param {Object}   config   - Configuración de SweetAlert2 (title, text, icon, etc.).
       * @param {Function} [callback] - Función a ejecutar tras cerrar el diálogo.
       *
       * @returns {Promise<void>}
       */
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
      /**
       * @description Provee la configuración por defecto y restricciones de seguridad para modales SweetAlert2.
       *
       * @param {Object} config - Configuración base del modal.
       *
       * @returns {Object} Configuración enriquecida sin cierre accidental.
       */
      predef: (config) => {
        return {
          icon: config && config.icon ? config.icon : undefined,
          allowOutsideClick: false,
          allowEnterKey: false,
          allowEscapeKey: false,
        };
      },
    },
    /**
     * Sanitiza cadenas HTML eliminando etiquetas script y atributos de evento inline (onclick, onchange, etc.)
     * para cumplimiento estricto de Content Security Policy (CSP - Manifest V3).
     * @param {string} html
     * @returns {string}
     */
    cleanCspHtml: (html) => {
      if (typeof html !== "string") return html;
      return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, "")
        .replace(/\s+on[a-z]{3,25}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\b(href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '$1="#"');
    },
    /**
     * @description Realiza una petición GET para cargar vistas parciales y las parsea según el tipo solicitado.
     *
     * @param {string} url  - URL del recurso a solicitar.
     * @param {string} type - Tipo de parser a aplicar ('dom', 'json', 'plain', etc.).
     *
     * @returns {Promise<any>} Contenido parseado.
     */
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
      /**
       * @description Parsea una cadena HTML en nodos jQuery aplicando sanitización previa contra violaciones CSP.
       *
       * @param {string} string - Cadena HTML a parsear.
       *
       * @returns {jQuery} Colección de nodos DOM parseados.
       */
      dom: (string) => {
        if (typeof string === "string") {
          let clean = Salem.utils.cleanCspHtml(string);
          let parser = new DOMParser();
          let doc = parser.parseFromString(clean, "text/html");
          return $(doc.body.childNodes);
        }
        return $(string);
      },
      /**
       * @description Convierte una cadena JSON a objeto JavaScript.
       *
       * @param {string|Object} string - Cadena JSON o objeto directo.
       *
       * @returns {Object} Objeto parseado.
       */
      json: (string) => {
        return typeof string == "object" ? string : JSON.parse(string);
      },
      /**
       * @description Retorna la cadena de texto plana sin transformaciones.
       *
       * @param {string} string - Texto de entrada.
       *
       * @returns {string} Mismo texto sin cambios.
       */
      plain: (string) => {
        return string;
      },
      /**
       * @description Parsea una cadena de texto en formato CSV a un array de objetos utilizando delimitador de OTOBO.
       *
       * @param {string} string - Contenido CSV a parsear.
       *
       * @returns {Array<Object>} Lista de registros con cabeceras como propiedades.
       */
      csv: (string) => {
        if (!string || typeof string !== "string") return [];
        let cleanStr = string.trim();
        if (!cleanStr) return [];

        // 1. Intentar con PapaParse con delimitador ';' y limpieza de comillas
        if (typeof Papa !== "undefined" && Papa.parse) {
          try {
            let papaRes = Papa.parse(cleanStr, {
              header: true,
              delimiter: ";",
              skipEmptyLines: true,
              dynamicTyping: false,
              transformHeader: (h) => (h || "").replace(/^"|"$/g, "").trim(),
              transform: (v) => (v || "").replace(/^"|"$/g, "").trim()
            });
            if (papaRes && Array.isArray(papaRes.data) && papaRes.data.length > 0) {
              let firstRow = papaRes.data[0];
              if (Object.keys(firstRow).length > 1 || !cleanStr.includes(";")) {
                return papaRes.data;
              }
            }
          } catch (err) {
            console.warn("Salem :: Papa.parse error, usando parser nativo:", err);
          }
        }

        // 2. Parser nativo específico para CSV de OTOBO
        let lines = cleanStr.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) return [];

        let delimiter = lines[0].includes(";") ? ";" : (lines[0].includes(",") ? "," : "\t");

        let parseLine = (line) => {
          let values = [];
          let inQuotes = false;
          let current = "";
          for (let i = 0; i < line.length; i++) {
            let char = line[i];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === delimiter && !inQuotes) {
              values.push(current.replace(/^"|"$/g, "").replace(/""/g, '"').trim());
              current = "";
              continue;
            }
            current += char;
          }
          values.push(current.replace(/^"|"$/g, "").replace(/""/g, '"').trim());
          return values;
        };

        let headers = parseLine(lines[0]);
        let data = [];

        for (let i = 1; i < lines.length; i++) {
          let values = parseLine(lines[i]);
          if (values.length === 0 || (values.length === 1 && values[0] === "")) continue;
          let row = {};
          headers.forEach((header, idx) => {
            if (header) {
              row[header] = typeof values[idx] !== "undefined" ? values[idx] : "";
            }
          });
          data.push(row);
        }

        return data;
      },
      /**
       * @description Parsea el contenido HTML de un formulario y extrae sus campos como objeto clave-valor.
       *
       * @param {string} string - Cadena HTML del formulario.
       *
       * @returns {Object} Diccionario con los nombres y valores de los campos del formulario.
       */
      form: (string) => {
        return Salem.utils.getFormValues(string, "dom");
      },
      /**
       * @description Extrae la información estructurada de un ticket a partir de un fragmento HTML.
       *
       * @param {string} string - Cadena HTML a inspeccionar.
       *
       * @returns {Promise<Object>} Datos del ticket extraídos.
       */
      info: async (string) => {
        let res = await Salem.core.runtime.getInfo({ dom: string });
        return res;
      },
      /**
       * @description Convierte las propiedades de un objeto JSON en una lista formateada en HTML con saltos <br>.
       *
       * @param {Object} json - Objeto con datos a formatear.
       *
       * @returns {string} Cadena HTML formateada.
       */
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
    /**
     * @description Redirige la navegación de la ventana activa hacia la URL especificada.
     *
     * @param {string} route - Destino de redirección.
     *
     * @returns {void}
     */
    router: (route) => {
      window.location.href = route;
    },
    /**
     * @description Extrae y normaliza los valores de un formulario a partir de un evento de submit o fragmento DOM.
     *
     * @param {Event|string|jQuery} submitEvent - Evento de envío, cadena HTML o elemento formulario.
     * @param {string}              [type]      - Tipo de origen ('dom', 'form', o indefinido).
     * @param {boolean}             [group]     - Si es verdadero, agrupa campos dinámicos bajo la propiedad 'original'.
     *
     * @returns {Object} Diccionario con los campos y valores extraídos del formulario.
     */
    getFormValues: (submitEvent, type, group) => {
      let data = null;
      if (typeof type == "undefined") {
        data = $(submitEvent.currentTarget).serializeArray();
      } else if (type == "dom") {
        if (typeof submitEvent === "string") {
          let clean = Salem.utils.cleanCspHtml(submitEvent);
          let parser = new DOMParser();
          let doc = parser.parseFromString(clean, "text/html");
          data = $(doc).find("form").serializeArray();
        } else {
          data = $(submitEvent).find("form").serializeArray();
        }
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
    /**
     * @description Muestra u oculta la pantalla de carga visual de Salem con título y mensaje configurables.
     *
     * @param {Object|null} [config] - Configuración del modal con título y mensaje, o null para ocultarlo.
     *
     * @returns {Promise<void>}
     */
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
    /**
     * @description Despliega una vista de error en el contenedor principal de la extensión.
     *
     * @param {Object} config - Datos descriptivos del error a desplegar.
     *
     * @returns {Promise<void>}
     */
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
    /**
     * @description Convierte una cadena con etiquetas HTML en texto plano limpio eliminando marcado y scripts.
     *
     * @param {string} string - Cadena HTML a transformar.
     *
     * @returns {string} Texto plano resultante sin etiquetas HTML.
     */
    htmlToText: (string) => {
      let clean = Salem.utils.cleanCspHtml(string);
      let tmp = document.createElement("div");
      tmp.innerHTML = clean;
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
      /**
       * @description Carga, evalúa middleware y despliega una vista de panel en la barra lateral de la extensión.
       *
       * @param {string} panel - Identificador del panel a cargar según Salem.rules.routes.panels.
       *
       * @returns {Promise<void>}
       */
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
      /**
       * @description Inyecta dinámicamente un script en el contexto seguro de la extensión con protección CSP para MV3.
       *
       * @param {string} route - Ruta relativa del archivo de script a inyectar.
       *
       * @returns {void}
       */
      injectScript: (route) => {
        // ── GUARD CSP (Manifest V3) ─────────────────────────────────────────
        // Solo se ejecuta en contexto chrome-extension:// (popup/sidebar).
        // En pages de extensión, 'script-src self' permite <script src="chrome-extension://...">
        // lo cual es seguro. En OTOBO (content_script), la CSP del sitio lo bloquearía,
        // por eso el guard retorna temprano si el contexto no es de extensión.
        // ──────────────────────────────────────────────────────────────────────
        if (typeof window === "undefined" || window.location.protocol !== "chrome-extension:") {
          console.warn(
            "[SALEM][CSP] injectScript omitido fuera del contexto de la extensión (ventana web OTOBO):",
            route
          );
          return;
        }
        const url = chrome.runtime.getURL(route);
        const script = document.createElement("script");
        script.setAttribute("tag-name", "partialScript");
        script.setAttribute("src", url);
        const head =
          document.head ||
          document.getElementsByTagName("head")[0] ||
          document.documentElement;
        head.insertBefore(script, head.lastChild);
      },
    },
    environ: {
      /**
       * @description Cambia el entorno de la extensión al modo de desarrollo solicitando un token de acceso.
       *
       * @returns {Promise<void>}
       */
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
      /**
       * @description Restablece el entorno de la extensión al modo de producción eliminando el token de desarrollo.
       *
       * @returns {Promise<void>}
       */
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
      workspace: "https://script.google.com/a/macros/rbsas.co/s/AKfycbxIjCSxv1abCQE0kk4BWALYSsM3HuHd1kvlHu2a41JSnAJfOVmB1-kXBqp7oEgmdKO5/exec",
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
        fiscalizadores: {
          view: "/sources/popup/menus/planes/fiscalizadores/fiscalizadores.html",
          script: "/sources/popup/menus/planes/fiscalizadores/fiscalizadores.js",
          title: "Mantenimiento preventivo Fiscalizadores",
          message: "Genere tickets de preventivo para equipos Fiscalizadores.",
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

// Ejecutar listen() en cualquier contexto window (isOTRS() dentro protege el código de MRA)
if (typeof window !== "undefined") Salem.core.listen();

