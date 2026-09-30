/**
 * A simple room outline with the meeting spot marked. Attendees don't get the
 * venue's floor-plan image, so this places the spot by its x/y (0–1
 * fractions of the plan) inside a plain rectangle.
 */
export function FloorPlan({
  x,
  y,
  number,
  label,
}: {
  x: number
  y: number
  number: number
  label: string
}) {
  const width = 340
  const height = 220
  const pad = 30
  const cx = pad + Math.min(1, Math.max(0, x)) * (width - pad * 2)
  const cy = pad + Math.min(1, Math.max(0, y)) * (height - pad * 2)
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className="h-auto w-full"
    >
      <rect
        x="6"
        y="6"
        width={width - 12}
        height={height - 12}
        rx="12"
        fill="var(--background)"
        stroke="var(--input)"
        strokeWidth="2"
      />
      <circle cx={cx} cy={cy} r="22" fill="var(--primary)" opacity="0.18" />
      <circle cx={cx} cy={cy} r="15" fill="var(--primary)" />
      <text
        x={cx}
        y={cy + 4.5}
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fill="var(--primary-foreground)"
      >
        {number}
      </text>
    </svg>
  )
}
