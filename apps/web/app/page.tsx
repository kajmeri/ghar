import { Amounts } from './_components/amounts';
import { ColorSwatches } from './_components/color-swatches';
import { Controls } from './_components/controls';
import { Radii } from './_components/radii';
import { Spacing } from './_components/spacing';
import { TokenSection } from './_components/token-section';
import { TypeScale } from './_components/type-scale';

export default function TokensPage() {
  return (
    <main className="mx-auto w-full max-w-content px-4 pt-8 pb-[calc(env(safe-area-inset-bottom)+--spacing(8))] md:px-8 md:pt-12">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold">Casa tokens</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every value on this page comes from packages/tokens/tokens.json.
        </p>
      </header>

      <div className="flex flex-col gap-12">
        <TokenSection title="Color" description="Chrome is monochrome. Color only carries meaning.">
          <ColorSwatches />
        </TokenSection>
        <TokenSection
          title="Amounts"
          description="600 weight, -0.02em tracking, tabular figures. Formatted by formatCents."
        >
          <Amounts />
        </TokenSection>
        <TokenSection title="Type scale" description="Public Sans, variable.">
          <TypeScale />
        </TokenSection>
        <TokenSection title="Radii" description="12px cards, 8px inputs and buttons, 999px pills.">
          <Radii />
        </TokenSection>
        <TokenSection title="Spacing" description="A 4px grid.">
          <Spacing />
        </TokenSection>
        <TokenSection
          title="Controls"
          description="The primary button is ink. Tap targets are at least 44px."
        >
          <Controls />
        </TokenSection>
      </div>
    </main>
  );
}
