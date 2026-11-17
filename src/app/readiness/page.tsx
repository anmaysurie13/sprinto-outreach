import { CheckCircle2, Hammer, TriangleAlert } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { CATEGORIES, DECISIONS } from "@/lib/readiness";

export const metadata = { title: "Build Readiness — Sprinto Outreach" };

export default function Readiness() {
  return (
    <>
      <PageHeader
        title="Build Readiness"
        description="The faculty's nine pre-build checks and five pre-build decisions. These are business-viability checks, separate from the technical validation rules inside the pipeline."
      />

      <Card className="mb-6 border-[var(--ok-fg)]/30">
        <CardBody className="flex items-start gap-4">
          <span className="tone-ok grid h-11 w-11 shrink-0 place-items-center rounded-xl">
            <Hammer className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Overall decision</p>
            <p className="text-xl font-semibold text-ink">BUILD CONTROLLED PROTOTYPE</p>
            <p className="mt-1 text-sm text-muted">
              No kill switch is a NO. Checks 07 and 08 are PARTIAL, so a human stays in the loop: the app only sends to a test inbox, and the Growth Lead reviews uncertain cases.
            </p>
          </div>
        </CardBody>
      </Card>

      <div className="space-y-6">
        {CATEGORIES.map((cat) => (
          <Card key={cat.name}>
            <CardHeader title={cat.name} action={<Badge tone={cat.tone}>{cat.rule}</Badge>} />
            <ul className="divide-y divide-line">
              {cat.checks.map((c) => (
                <li key={c.n} className="flex gap-4 px-5 py-4">
                  <span className="w-7 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-muted">{c.n}.</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink">{c.q}</p>
                      <Badge tone={c.verdict === "YES" ? "ok" : "warn"}>
                        {c.verdict === "YES" ? <CheckCircle2 className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />} {c.verdict}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader title="Five pre-build decisions" subtitle="Faculty-provided targets — not achieved results. Actual figures will only appear after real testing." />
        <dl className="divide-y divide-line">
          {DECISIONS.map((d) => (
            <div key={d.k} className="grid gap-1 px-5 py-3 sm:grid-cols-[160px_1fr] sm:gap-4">
              <dt className="text-sm font-medium text-ink">{d.k}</dt>
              <dd className="text-sm text-muted">{d.v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}
