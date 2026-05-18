(function ($) {
  const NS = ".genrpg-item-template-management";
  const ROOT_ID = "genrpg-item-template-management";

  let instanceGuid = null;
  let editingGuid = null;
  let table = null;
  let $root = null;
  let $form = null;
  let $message = null;
  let $submitButton = null;
  let $cancelButton = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[character];
    });
  }

  function formatWeight(value) {
    if (value === null || value === undefined) {
      return "—";
    }
    return String(value);
  }

  function setMessage(text, tone) {
    if (!$message) {
      return;
    }
    $message.text(text || "");
    if (tone) {
      $message.attr("data-tone", tone);
    } else {
      $message.removeAttr("data-tone");
    }
  }

  function apiBase() {
    return `/api/genrpg/instances/${instanceGuid}/item-templates`;
  }

  async function requestJson(url, options) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    if (response.status === 401) {
      window.location.assign("/login");
      return null;
    }

    if (response.status === 204) {
      return {};
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    return data;
  }

  function resetForm() {
    editingGuid = null;
    if ($form) {
      $form[0].reset();
    }
    $submitButton.text("Save");
    $cancelButton.prop("hidden", true);
    setMessage("");
  }

  function fillForm(template) {
    editingGuid = template.guid;
    $form.find('[name="name"]').val(template.name || "");
    $form.find('[name="description"]').val(template.description || "");
    $form.find('[name="weight"]').val(
      template.weight === null || template.weight === undefined ? "" : template.weight,
    );
    $submitButton.text("Update");
    $cancelButton.prop("hidden", false);
    setMessage("");
    $form.find('[name="name"]').trigger("focus");
  }

  function readFormPayload() {
    const formData = new FormData($form[0]);
    const weightRaw = formData.get("weight");
    return {
      name: String(formData.get("name") || "").trim(),
      description: String(formData.get("description") || ""),
      weight: weightRaw === "" ? null : weightRaw,
    };
  }

  async function loadTemplates() {
    const data = await requestJson(apiBase());
    if (!data) {
      return;
    }
    table.setData(data.itemTemplates || []);
  }

  function ensureTable() {
    if (table) {
      return table;
    }

    table = new Table({
      id: "item-templates-table",
      rowCount: { show: true, nounSingular: "template", nounPlural: "templates" },
      searchPlaceholder: "Search templates…",
      defaultSort: { field: "name" },
      columns: [
        { title: "Name", searchable: true },
        {
          title: "Description",
          searchable: true,
          valueFunction: (row) => row.description || "",
          renderFunction: (value) => escapeHtml(value || ""),
        },
        {
          title: "Weight",
          renderFunction: (value) => escapeHtml(formatWeight(value)),
        },
        {
          title: "Actions",
          sortable: false,
          headerClass: "actions-cell",
          cellClass: "actions-cell",
          renderFunction: (_value, row) => {
            const $container = $("<div>", { class: "item-template-actions" });
            $container.append(
              $("<button>", {
                type: "button",
                class: "secondary-button item-template-actions__btn edit-item-template-btn",
                title: "Edit",
                "aria-label": "Edit",
                text: "✏️",
              }).attr("data-template-guid", row.guid),
            );
            $container.append(
              $("<button>", {
                type: "button",
                class: "danger-button-outline item-template-actions__btn delete-item-template-btn",
                title: "Delete",
                "aria-label": "Delete",
                text: "🗑️",
              }).attr("data-template-guid", row.guid),
            );
            return $container;
          },
        },
      ],
      emptyState: {
        message: "No item templates",
        icon: "",
        detailNoData: "Create a template using the form above.",
      },
    });

    $root.find(".item-template-management__table").empty().append(table.init());
    return table;
  }

  function buildRoot() {
    if ($("#" + ROOT_ID).length) {
      return $("#" + ROOT_ID);
    }

    $root = $("<section>", {
      id: ROOT_ID,
      class: "item-template-management",
      "aria-label": "Item template management",
    });

    $root.append($("<h2>", { class: "item-template-management__heading", text: "Item Templates" }));

    $form = $("<form>", { class: "item-template-management__form" });
    $form.append(
      $("<label>").append(
        $("<span>", { text: "Name" }),
        $("<input>", {
          name: "name",
          type: "text",
          required: true,
          maxlength: 120,
          autocomplete: "off",
        }),
      ),
    );
    $form.append(
      $("<label>").append(
        $("<span>", { text: "Description" }),
        $("<textarea>", { name: "description", rows: 2, maxlength: 2000 }),
      ),
    );
    $form.append(
      $("<label>").append(
        $("<span>", { text: "Weight" }),
        $("<input>", { name: "weight", type: "number", step: "any", min: "0" }),
      ),
    );

    const $formActions = $("<div>", { class: "item-template-management__form-actions" });
    $submitButton = $("<button>", { type: "submit", text: "Save" });
    $cancelButton = $("<button>", {
      type: "button",
      class: "secondary-button",
      text: "Cancel",
      hidden: true,
    });
    $formActions.append($submitButton, $cancelButton);
    $form.append($formActions);

    $message = $("<p>", {
      class: "item-template-management__message",
      role: "status",
    });

    $root.append($form, $message, $("<div>", { class: "item-template-management__table" }));
    $("body").append($root);

    ensureTable();
    bindEvents();
    return $root;
  }

  function bindEvents() {
    $form.on("submit" + NS, async function (event) {
      event.preventDefault();
      const payload = readFormPayload();

      if (!payload.name) {
        setMessage("Name is required.", "error");
        return;
      }

      $submitButton.prop("disabled", true);

      try {
        if (editingGuid) {
          await requestJson(`${apiBase()}/${editingGuid}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          setMessage("Template updated.", "success");
        } else {
          await requestJson(apiBase(), {
            method: "POST",
            body: JSON.stringify(payload),
          });
          setMessage("Template created.", "success");
        }

        resetForm();
        await loadTemplates();
      } catch (error) {
        setMessage(error.message, "error");
      } finally {
        $submitButton.prop("disabled", false);
      }
    });

    $cancelButton.on("click" + NS, resetForm);

    $root.on("click" + NS, ".edit-item-template-btn", async function () {
      const templateGuid = $(this).attr("data-template-guid");
      try {
        const data = await requestJson(`${apiBase()}/${templateGuid}`);
        if (data?.itemTemplate) {
          fillForm(data.itemTemplate);
        }
      } catch (error) {
        setMessage(error.message, "error");
      }
    });

    $root.on("click" + NS, ".delete-item-template-btn", async function () {
      const templateGuid = $(this).attr("data-template-guid");
      if (!window.confirm("Delete this item template?")) {
        return;
      }

      try {
        await requestJson(`${apiBase()}/${templateGuid}`, { method: "DELETE" });
        if (editingGuid === templateGuid) {
          resetForm();
        }
        setMessage("Template deleted.", "success");
        await loadTemplates();
      } catch (error) {
        setMessage(error.message, "error");
      }
    });
  }

  function unbindEvents() {
    if ($form) {
      $form.off(NS);
    }
    if ($cancelButton) {
      $cancelButton.off(NS);
    }
    if ($root) {
      $root.off(NS);
    }
  }

  function mount(detail) {
    instanceGuid = detail.instanceGuid;
    buildRoot();
    resetForm();
    loadTemplates().catch((error) => {
      setMessage(error.message, "error");
    });
  }

  function teardown() {
    unbindEvents();
    if ($root) {
      $root.remove();
    }
    $root = null;
    $form = null;
    $message = null;
    $submitButton = null;
    $cancelButton = null;
    table = null;
    instanceGuid = null;
    editingGuid = null;
  }

  $(window).on("genrpg:instance-entered" + NS, function (event) {
    const detail = event.originalEvent?.detail || {};
    mount(detail);
  });

  $(window).on("genrpg:instance-exited" + NS, teardown);
})(jQuery);
