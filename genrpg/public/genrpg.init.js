(function ($) {
  const NS = ".genrpg-init";
  let appLayout = null;
  let itemTemplateManagement = null;

  function init(detail) {
    if (!detail?.instanceGuid) {
      return;
    }

    window.appLayout = appLayout = new AppLayout();
    $("body").append(appLayout.build());

    appLayout
      .getSection("header")
      .append($("<h1>", { class: "app-layout__title", text: "GenRPG" }));

    itemTemplateManagement = new ItemTemplateManagement({
      instanceGuid: detail.instanceGuid,
    });
    appLayout.getSection("content").append(itemTemplateManagement.init());
  }

  function teardown() {
    if (itemTemplateManagement) {
      itemTemplateManagement.destroy();
      itemTemplateManagement = null;
    }

    if (appLayout) {
      appLayout.destroy();
      appLayout = null;
    }

    window.appLayout = null;
  }

  $(window).on("genrpg:package-loaded" + NS, function (event) {
    init(event.originalEvent?.detail || {});
  });

  $(window).on("genrpg:package-exited" + NS, teardown);
})(jQuery);
