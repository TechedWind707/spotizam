!async function () {
  while (!window.Spicetify || !Spicetify.showNotification) {
    await new Promise(function (resolve) { return setTimeout(resolve, 50); });
  }

  try {
    console.log("[spotizam-app] custom app extension loaded");
  } catch (_) {}
}();
