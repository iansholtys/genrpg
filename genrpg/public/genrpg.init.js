(function ($) {
  const NS = ".genrpg-init";
  let itemTemplateManagement = null;

  function init(detail) {
    if (!detail?.instanceGuid) {
      return;
    }

    itemTemplateManagement = new ItemTemplateManagement({
      instanceGuid: detail.instanceGuid,
    });
    itemTemplateManagement.mount();
  }

  function teardown() {
    if (itemTemplateManagement) {
      itemTemplateManagement.destroy();
      itemTemplateManagement = null;
    }
  }

  $(window).on("genrpg:instance-entered" + NS, function (event) {
    init(event.originalEvent?.detail || {});
  });

  $(window).on("genrpg:instance-exited" + NS, teardown);
})(jQuery);
