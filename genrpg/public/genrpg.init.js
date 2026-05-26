(function ($) {
  const NS = ".genrpg-init";
  const { Menu, Modal } = window;
  let appLayout = null;
  let contentTabs = null;
  let itemsPanel = null;
  let characterManagement = null;
  let instanceMenu = null;
  let settingsModal = null;

  function accountMenuLabel() {
    const { user } = window;
    if (user) {
      return user.email || user.displayName || "Signed in";
    }
    return "Signed in";
  }

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
      direction: "below",
      alignment: "right",
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
          // Defer so Menu's closeOnItemClick runs before teardown destroys the menu DOM.
          onClick: () => {
            queueMicrotask(() => {
              window.dispatchEvent(new CustomEvent("genrpg:exit-instance"));
            });
          },
        },
        {
          type: "group",
          behavior: { dividers: true },
          items: [
            { text: accountMenuLabel() },
            {
              text: "Log Out",
              onClick: () => $("#logoutForm").trigger("submit"),
            },
          ],
        },
      ],
    });

    appLayout.getSection("header").append(instanceMenu.init());

    itemsPanel = new ItemsPanel({
      instanceGuid: detail.instanceGuid,
    });
    characterManagement = new CharacterManagement({
      instanceGuid: detail.instanceGuid,
    });

    contentTabs = new TabbedRegion({
      id: "genrpg-instance-tabs",
      ariaLabel: "Instance content",
    });
    contentTabs
      .addTab("items", "Items", itemsPanel.init())
      .addTab("characters", "Characters", characterManagement.init());

    appLayout.getSection("content").append(contentTabs.init());
  }

  function teardown() {
    instanceMenu?.destroy();
    instanceMenu = null;

    settingsModal?.destroy();
    settingsModal = null;

    itemsPanel?.destroy();
    itemsPanel = null;

    characterManagement?.destroy();
    characterManagement = null;

    contentTabs?.destroy();
    contentTabs = null;

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
