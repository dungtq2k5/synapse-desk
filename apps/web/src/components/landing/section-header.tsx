/** A landing section's `h2` and its lead line. */
export function SectionHeader({
  id,
  title,
  lead,
}: {
  /** The heading's id, for the section's `aria-labelledby`. */
  id: string;
  title: string;
  lead: string;
}) {
  return (
    <div className="flex max-w-160 flex-col gap-2">
      <h2 id={id} className="text-3xl/9.5 font-semibold tracking-[-0.02em]">
        {title}
      </h2>
      <p className="text-base text-muted-foreground">{lead}</p>
    </div>
  );
}
