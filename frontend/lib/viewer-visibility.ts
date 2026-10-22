/** IntersectionObserver also accounts for clipping by an embedding iframe. */
export function observeViewerVisibility(element: HTMLElement, onChange: (visible: boolean) => void): () => void {
  let intersecting = false;
  let lastVisible: boolean | undefined;
  const update = () => {
    const visible = intersecting && !document.hidden;
    if (visible === lastVisible) return;
    lastVisible = visible;
    onChange(visible);
  };
  const observer = new IntersectionObserver(([entry]) => {
    intersecting = !!entry?.isIntersecting && entry.intersectionRatio > 0;
    update();
  });
  document.addEventListener("visibilitychange", update);
  observer.observe(element);
  update();
  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", update);
  };
}
