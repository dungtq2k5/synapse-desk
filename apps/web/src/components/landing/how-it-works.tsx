import { FlowGraph } from './flow-graph';
import { SectionHeader } from './section-header';

/** How it works: one question's journey, as the flow graph. */
export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className="scroll-mt-14 px-4 py-16 md:scroll-mt-16 md:py-24 xl:px-0"
    >
      <div className="mx-auto max-w-300">
        <SectionHeader
          id="how-it-works-title"
          title="How it works"
          lead="One question’s journey, from asking to a better knowledge base."
        />
        <FlowGraph />
      </div>
    </section>
  );
}
