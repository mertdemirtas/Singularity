// Runs before the stylesheet and application bundle, including on a new origin.
(() => {
  try {
    const appearance = window.plainEditorDesktop?.startupAppearance || JSON.parse(localStorage.getItem('singularity.startupAppearance') || 'null');
    if (!appearance || !/^#[a-f\d]{6}$/i.test(appearance.background) || !/^#[a-f\d]{6}$/i.test(appearance.foreground)) return;
    const style = document.documentElement.style;
    style.setProperty('--plain-startup-background', appearance.background);
    style.setProperty('--plain-startup-foreground', appearance.foreground);
    style.setProperty('--theia-ui-font-family', appearance.fontFamily);
    style.setProperty('--plain-font-family', appearance.fontFamily);
  } catch (error) { console.warn('Singularity: could not restore startup appearance', error); }
})();
