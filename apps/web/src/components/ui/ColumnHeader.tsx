export function ColumnHeader({
  label,
  tip,
}: {
  label: string;
  tip: string;
}) {
  return (
    <span className="column-header" title={tip} data-tip={tip}>
      {label}
    </span>
  );
}
