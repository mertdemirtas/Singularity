'use strict';

const { decorate, injectable } = require('@theia/core/shared/inversify');
const { ViewContainer, ViewContainerIdentifier, ViewContainerPart } = require('@theia/core/lib/browser/view-container');

class InteractiveViewContainer extends ViewContainer {
  createPart(...args) {
    const part = super.createPart(...args);
    // Theia 1.76 adds a mouseenter listener on every resize which disables
    // pointer events for 100 ms. The first click after entering a resized pane
    // then hits its parent instead of Commit, a file, or an extension control.
    // This hook only installs that suppression; normal resize/layout handling
    // remains in ViewContainerPart.onResize.
    part.handleResize = () => {};
    return part;
  }
}
decorate(injectable(), InteractiveViewContainer);

module.exports = rebind => {
  // Match the section's 24 px line plus 4 px padding on each side in CSS.
  // The layout also uses this height for collapsed parts and restored sizes.
  ViewContainerPart.HEADER_HEIGHT = 32;
  rebind(ViewContainer.Factory).toFactory(({ container }) => options => {
    const child = container.createChild();
    child.bind(ViewContainerIdentifier).toConstantValue(options);
    child.bind(ViewContainer).to(InteractiveViewContainer).inSingletonScope();
    return child.get(ViewContainer);
  });
};
