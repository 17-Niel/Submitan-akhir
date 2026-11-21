export function runViewTransition(updateView) {
  if (!document.startViewTransition) {
    updateView();
    return;
  }

  document.startViewTransition(updateView);
}
