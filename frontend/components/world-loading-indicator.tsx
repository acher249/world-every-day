type WorldLoadingIndicatorProps = {
  progress?: number | null;
  visible?: boolean;
};

export function WorldLoadingIndicator({ progress = null, visible = true }: WorldLoadingIndicatorProps) {
  const boundedProgress = progress === null ? null : Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div
      className="spark-loading"
      data-visible={visible}
      data-indeterminate={boundedProgress === null}
      role="status"
      aria-hidden={!visible}
    >
      <span className="spark-loading-dot" aria-hidden="true" />
      <span>Loading world</span>
      <span
        className="spark-loading-progress"
        role="progressbar"
        aria-label="World loading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={boundedProgress ?? undefined}
      >
        <span style={boundedProgress === null ? undefined : { width: `${boundedProgress}%` }} />
      </span>
      {boundedProgress !== null && <small>{boundedProgress}%</small>}
    </div>
  );
}
