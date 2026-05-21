(function ($) {
  const NS = ".genrpg-init";
  const { Menu, Modal } = window;
  let appLayout = null;
  let itemTemplateManagement = null;
  let instanceMenu = null;
  let settingsModal = null;

  function init(detail) {
    if (!detail?.instanceGuid) {
      return;
    }

    $(".topbar").prop("hidden", true);

    window.appLayout = appLayout = new AppLayout({
      header: { floating: "right" },
    });
    const $appLayout = appLayout.build().prop("hidden", true);
    $("body").append($appLayout);


    instanceMenu = new Menu({
      id: "instance-header-menu",
      preset: "top-right",
      behavior: { closeDelay: 300 },
      items: [
        {
          text: "Settings",
          onClick: () => {
            if (!settingsModal) {
              settingsModal = new Modal("settings-modal", "Settings", {
                enterAnimation: { preset: "scale-down", scale: 1.1 },
                exitAnimation: { preset: "scale-down", scale: 1.1 },
              });
              settingsModal.getContent = () =>
                $("<p>", { text: "Settings will go here eventually." });
            }
            settingsModal.show();
          },
        },
        {
          text: "Exit",
          onClick: () => window.dispatchEvent(new CustomEvent("genrpg:exit-instance")),
        },
        {
          text: "Log Out",
          onClick: () => $("#logoutForm").trigger("submit"),
        },
      ],
    });


    appLayout.getSection("header").append(instanceMenu.init());

    itemTemplateManagement = new ItemTemplateManagement({
      instanceGuid: detail.instanceGuid,
    });
    appLayout.getSection("content").append(itemTemplateManagement.init());
  }

  function teardown() {
    instanceMenu?.destroy();
    instanceMenu = null;

    settingsModal?.destroy();
    settingsModal = null;

    itemTemplateManagement?.destroy();
    itemTemplateManagement = null;

    appLayout?.destroy();
    appLayout = null;

    window.appLayout = null;
    $(".topbar").prop("hidden", false);
  }

  $(window).on("genrpg:package-loaded" + NS, function (event) {
    init(event.originalEvent?.detail || {});
  });

  $(window).on("genrpg:package-exited" + NS, teardown);
})(jQuery);
