export default function StatusBadge({ value }) {
  const normalized = String(value || '').replace(/\s+/g, '-').toLowerCase();
  return <span className={`status status-${normalized}`}><i/>{value}</span>;
}
